package com.zahill.tv;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupWindow;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Zahill TV Home (TV_LAUNCHER_PLAN.md, Phase 1). Built in code like tv-home, which it started
 * from: background photo, logo, clock / date / weather, a welcome block from the PMS
 * (/api/display/room/:roomId/state), a "Watch" row of streaming apps and an "At <hotel>" row
 * of hotel info screens. An empty room shows a "Welcome to your room" card until OK is pressed.
 * Hold OK 3 s anywhere to open the settings (Room ID / token).
 *
 * All sizes are in pixels of the 1920×1080 design (tv-launcher/design), scaled to the screen.
 */
public class MainActivity extends Activity {

    static final TimeZone HOTEL_TZ = TimeZone.getTimeZone("Asia/Makassar");
    static final int DEFAULT_ACCENT = 0xFFC9A227;
    static final int GROUND = 0xFF05070A;
    static final int TEXT = 0xFFF4F1EA, TEXT_2 = 0xFFD9D4C7, LABEL = 0xFFB7B1A3;
    static final long REFRESH_MS = 60_000, BG_ROTATE_MS = 30_000, HOLD_FOR_SETTINGS_MS = 3000;

    private String[] watchApps;
    private String liveTvPkg, inputPickerPkg;
    private float s; // screen pixels per design pixel
    private int accent = DEFAULT_ACCENT;
    private String lang = "en";
    private SharedPreferences prefs;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private final Map<String, Typeface> fonts = new HashMap<>();
    private final LruCache<String, Bitmap> images = new LruCache<String, Bitmap>(24 * 1024 * 1024) {
        @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
    };

    // Data
    private JSONObject state;         // last /state answer (null = not loaded / not set up)
    private List<String> bgUrls = new ArrayList<>();
    private int bgIndex = -1;
    private String shownBg;
    private String logoUrl;
    private boolean wasVacant;

    // Views
    private FrameLayout root, homeLayer, vacantLayer, castLayer;
    private ImageView wallBack, wallFront, logoView;
    private TextView logoText, clock, ampm, date, weatherText, eyebrow, nameText, roomText;
    private TextView watchLabel, zahillLabel, vacantTitle, vacantRoom, vacantReady, vacantWifi, vacantPress;
    private ImageView vacantLogo;
    private TextView vacantLogoText;
    private View weatherRow;
    private LinearLayout pillsRow, chipsRow, watchRow, zahillRow;
    private final List<View> pills = new ArrayList<>(), watchCards = new ArrayList<>(), zahillCards = new ArrayList<>();
    private final List<Runnable> accentPainters = new ArrayList<>();
    private PopupWindow inputsPopup;
    private int lastFocusedId = View.NO_ID;
    private int packageSeq;
    private boolean okHeld, settingsOpened;

    private final Runnable refresh = this::loadState;
    private final Runnable rotateBg = this::nextBackground;

    private final BroadcastReceiver tick = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { updateClock(); }
    };
    private final BroadcastReceiver packages = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { buildWatchRow(); }
    };

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = PmsClient.prefs(this);
        lang = "id".equals(prefs.getString(Preferences.KEY_LANG, "en")) ? "id" : "en";
        watchApps = getResources().getStringArray(R.array.watch_apps);
        liveTvPkg = getString(R.string.live_tv_package);
        inputPickerPkg = getString(R.string.input_picker_package);
        s = getResources().getDisplayMetrics().widthPixels / 1920f;
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        setContentView(buildUi());

        // Draw from the copy kept at the last good fetch, so a TV that boots without
        // network still greets the guest; the live answer replaces it.
        String saved = prefs.getString(Preferences.KEY_LAST_STATE, null);
        if (saved != null && PmsClient.configured(this)) {
            try { state = new JSONObject(saved); } catch (JSONException ignored) { }
        }
        applyState(true);
        buildWatchRow();

        IntentFilter pf = new IntentFilter();
        pf.addAction(Intent.ACTION_PACKAGE_ADDED);
        pf.addAction(Intent.ACTION_PACKAGE_REMOVED);
        pf.addAction(Intent.ACTION_PACKAGE_CHANGED);
        pf.addDataScheme("package");
        registerReceiver(packages, pf);
    }

    @Override
    protected void onResume() {
        super.onResume();
        IntentFilter tf = new IntentFilter(Intent.ACTION_TIME_TICK);
        tf.addAction(Intent.ACTION_TIME_CHANGED);
        tf.addAction(Intent.ACTION_TIMEZONE_CHANGED);
        registerReceiver(tick, tf);
        updateClock();
        // Catch installs / removals that happened while another app was in front.
        if (getPackageManager().getChangedPackages(packageSeq) != null) buildWatchRow();
        restoreFocus();
        loadState();
        if (bgUrls.size() > 1) scheduleBg(BG_ROTATE_MS);
        else if (shownBg == null) nextBackground();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(refresh);
        handler.removeCallbacks(rotateBg);
        unregisterReceiver(tick);
        if (inputsPopup != null) inputsPopup.dismiss();
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(packages);
        net.shutdownNow();
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Home pressed while already home: close what's open, back to the first app.
        if (inputsPopup != null) inputsPopup.dismiss();
        hideCast();
        if (!watchCards.isEmpty() && vacantLayer.getVisibility() != View.VISIBLE) watchCards.get(0).requestFocus();
    }

    @Override
    public void onBackPressed() {
        if (castLayer.getVisibility() == View.VISIBLE) hideCast();
        // Otherwise Home has nowhere to go back to.
    }

    // ---------------------------------------------------------------- layout

    private View buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(GROUND);
        root.setClipChildren(false);

        wallBack = photoLayer();
        wallFront = photoLayer();
        root.addView(wallBack, new FrameLayout.LayoutParams(-1, -1));
        root.addView(wallFront, new FrameLayout.LayoutParams(-1, -1));

        homeLayer = new FrameLayout(this);
        homeLayer.setClipChildren(false);
        root.addView(homeLayer, new FrameLayout.LayoutParams(-1, -1));
        // Shade behind the text: from the left (welcome block) and from the bottom (tile rows).
        View left = new View(this);
        left.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0xD905070A, 0x8C05070A, 0x2605070A, 0x0005070A}));
        homeLayer.addView(left, new FrameLayout.LayoutParams(-1, -1));
        View bottom = new View(this);
        bottom.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x8005070A, 0x0005070A, 0x0005070A, 0x9905070A, 0xF205070A}));
        homeLayer.addView(bottom, new FrameLayout.LayoutParams(-1, -1));
        homeLayer.addView(buildBody(), lp(-1, -2, Gravity.BOTTOM, d(88), 0, d(88), d(48)));

        vacantLayer = buildVacant();
        vacantLayer.setVisibility(View.GONE);
        root.addView(vacantLayer, new FrameLayout.LayoutParams(-1, -1));

        root.addView(buildHeader(), lp(-1, -2, Gravity.TOP, d(88), d(56), d(88), 0));

        castLayer = buildCast();
        castLayer.setVisibility(View.GONE);
        root.addView(castLayer, new FrameLayout.LayoutParams(-1, -1));
        return root;
    }

    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setClipChildren(false);

        FrameLayout logoBox = new FrameLayout(this);
        logoView = new ImageView(this);
        logoView.setScaleType(ImageView.ScaleType.FIT_START);
        logoView.setAdjustViewBounds(true);
        logoBox.addView(logoView, new FrameLayout.LayoutParams(d(260), d(130), Gravity.START | Gravity.TOP));
        logoText = text(40, serif(500), TEXT);
        logoText.setVisibility(View.GONE);
        logoBox.addView(logoText, new FrameLayout.LayoutParams(-2, -2, Gravity.START | Gravity.TOP));
        header.addView(logoBox, new LinearLayout.LayoutParams(0, -2, 1f));

        pillsRow = new LinearLayout(this);
        pillsRow.setClipChildren(false);
        pillsRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView inputs = pill(R.drawable.ic_inputs);
        inputs.setOnClickListener(this::showInputs);
        TextView language = pill(R.drawable.ic_language);
        language.setText("EN / ID");
        language.setOnClickListener(v -> toggleLanguage());
        for (TextView p : new TextView[]{inputs, language}) {
            pillsRow.addView(p, llp(-2, d(52), d(16), 0, 0, 0));
            pills.add(p);
        }
        header.addView(pillsRow, llp(-2, -2, 0, d(14), d(64), 0));

        LinearLayout clockCol = new LinearLayout(this);
        clockCol.setOrientation(LinearLayout.VERTICAL);
        clockCol.setGravity(Gravity.END);
        LinearLayout clockRow = new LinearLayout(this);
        clockRow.setGravity(Gravity.BOTTOM);
        clock = text(112, sans(200), TEXT);
        clock.setIncludeFontPadding(false);
        clockRow.addView(clock);
        ampm = text(28, sans(600), accent);
        ampm.setIncludeFontPadding(false);
        accentPainters.add(() -> ampm.setTextColor(accent));
        clockRow.addView(ampm, llp(-2, -2, d(8), 0, 0, d(14)));
        clockCol.addView(clockRow, new LinearLayout.LayoutParams(-2, -2));
        date = text(20, sans(500), TEXT_2);
        date.setLetterSpacing(0.25f);
        date.setSingleLine(true);
        clockCol.addView(date, llp(-2, -2, 0, d(14), 0, 0));

        LinearLayout wRow = new LinearLayout(this);
        wRow.setGravity(Gravity.CENTER_VERTICAL);
        ImageView wIcon = icon(R.drawable.ic_cloud, TEXT_2);
        wRow.addView(wIcon, new LinearLayout.LayoutParams(d(24), d(24)));
        weatherText = text(21, sans(400), TEXT_2);
        weatherText.setSingleLine(true);
        wRow.addView(weatherText, llp(-2, -2, d(10), 0, 0, 0));
        weatherRow = wRow;
        weatherRow.setVisibility(View.GONE);
        clockCol.addView(wRow, llp(-2, -2, 0, d(12), 0, 0));
        for (TextView t : new TextView[]{clock, ampm, date, weatherText}) t.setShadowLayer(d(14), 0, d(1), 0x99000000);
        header.addView(clockCol, new LinearLayout.LayoutParams(-2, -2));
        return header;
    }

    private View buildBody() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setClipChildren(false);
        col.setClipToPadding(false);

        eyebrow = text(22, sans(700), accent);
        eyebrow.setLetterSpacing(0.38f);
        eyebrow.setSingleLine(true);
        accentPainters.add(() -> eyebrow.setTextColor(accent));
        col.addView(eyebrow, new LinearLayout.LayoutParams(-2, -2));

        nameText = text(108, serif(500), TEXT);
        nameText.setSingleLine(true);
        nameText.setEllipsize(TextUtils.TruncateAt.END);
        nameText.setIncludeFontPadding(false);
        nameText.setShadowLayer(d(24), 0, 0, 0x66000000);
        col.addView(nameText, llp(-1, -2, 0, d(18), d(200), 0));

        roomText = text(28, sans(300), TEXT_2);
        roomText.setSingleLine(true);
        col.addView(roomText, llp(-2, -2, 0, d(14), 0, 0));

        chipsRow = new LinearLayout(this);
        chipsRow.setOrientation(LinearLayout.HORIZONTAL);
        col.addView(chipsRow, llp(-2, -2, 0, d(36), 0, 0));

        watchLabel = sectionLabel();
        col.addView(watchLabel, llp(-2, -2, 0, d(14), 0, d(18)));
        watchRow = new LinearLayout(this);
        watchRow.setClipChildren(false);
        watchRow.setClipToPadding(false);
        col.addView(watchRow, new LinearLayout.LayoutParams(-1, d(128)));

        zahillLabel = sectionLabel();
        col.addView(zahillLabel, llp(-2, -2, 0, d(42), 0, d(18)));
        zahillRow = new LinearLayout(this);
        zahillRow.setClipChildren(false);
        zahillRow.setClipToPadding(false);
        col.addView(zahillRow, new LinearLayout.LayoutParams(-1, d(158)));
        return col;
    }

    private TextView sectionLabel() {
        TextView t = text(18, sans(700), TEXT_2);
        t.setLetterSpacing(0.28f);
        t.setSingleLine(true);
        return t;
    }

    private FrameLayout buildVacant() {
        FrameLayout layer = new FrameLayout(this);
        View shade = new View(this);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x6605070A, 0x1405070A, 0x2605070A, 0xB305070A}));
        layer.addView(shade, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(d(60), d(64), d(60), d(56));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(28));
        bg.setColor(0xC2141210);
        bg.setStroke(Math.max(1, d(1.5f)), 0x2EFFFFFF);
        card.setBackground(bg);

        FrameLayout logoBox = new FrameLayout(this);
        vacantLogo = new ImageView(this);
        vacantLogo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logoBox.addView(vacantLogo, new FrameLayout.LayoutParams(d(320), d(200), Gravity.CENTER));
        vacantLogoText = text(56, serif(500), TEXT);
        vacantLogoText.setGravity(Gravity.CENTER);
        vacantLogoText.setVisibility(View.GONE);
        logoBox.addView(vacantLogoText, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        card.addView(logoBox, new LinearLayout.LayoutParams(-2, d(200)));

        View rule = new View(this);
        rule.setBackgroundColor(withAlpha(accent, 0.6f));
        accentPainters.add(() -> rule.setBackgroundColor(withAlpha(accent, 0.6f)));
        card.addView(rule, llp(d(64), Math.max(1, d(2)), 0, d(40), 0, d(40)));

        vacantTitle = text(60, serif(500), TEXT);
        card.addView(vacantTitle, new LinearLayout.LayoutParams(-2, -2));
        vacantRoom = text(24, sans(500), TEXT_2);
        vacantRoom.setLetterSpacing(0.3f);
        vacantRoom.setSingleLine(true);
        card.addView(vacantRoom, llp(-2, -2, 0, d(14), 0, 0));

        LinearLayout ready = new LinearLayout(this);
        ready.setGravity(Gravity.CENTER_VERTICAL);
        View dot = new View(this);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(0xFF4ADE80);
        dot.setBackground(dotBg);
        ready.addView(dot, new LinearLayout.LayoutParams(d(12), d(12)));
        vacantReady = text(20, sans(700), 0xFF86EFAC);
        vacantReady.setLetterSpacing(0.25f);
        ready.addView(vacantReady, llp(-2, -2, d(14), 0, 0, 0));
        card.addView(ready, llp(-2, -2, 0, d(34), 0, 0));

        layer.addView(card, new FrameLayout.LayoutParams(d(760), -2, Gravity.CENTER));

        vacantWifi = text(22, sans(400), TEXT_2);
        layer.addView(vacantWifi, lp(-2, -2, Gravity.BOTTOM | Gravity.START, d(88), 0, 0, d(56)));

        LinearLayout press = new LinearLayout(this);
        press.setGravity(Gravity.CENTER_VERTICAL);
        vacantPress = text(22, sans(400), TEXT_2);
        TextView key = text(22, sans(700), TEXT);
        key.setText("OK");
        key.setGravity(Gravity.CENTER);
        key.setPadding(d(14), d(4), d(14), d(4));
        GradientDrawable keyBg = new GradientDrawable();
        keyBg.setCornerRadius(d(8));
        keyBg.setColor(0x33000000);
        keyBg.setStroke(Math.max(1, d(1.5f)), 0x80FFFFFF);
        key.setBackground(keyBg);
        TextView after = text(22, sans(400), TEXT_2);
        press.addView(vacantPress);
        press.addView(key, llp(-2, -2, d(10), 0, d(10), 0));
        press.addView(after);
        press.setTag(after);
        layer.addView(press, lp(-2, -2, Gravity.BOTTOM | Gravity.END, 0, 0, d(88), d(52)));
        return layer;
    }

    private FrameLayout buildCast() {
        FrameLayout layer = new FrameLayout(this);
        layer.setBackgroundColor(0xCC05070A);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(d(64), d(56), d(64), d(56));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(28));
        bg.setColor(0xF2151820);
        bg.setStroke(Math.max(1, d(1.5f)), 0x2EFFFFFF);
        panel.setBackground(bg);
        ImageView ic = icon(R.drawable.ic_cast, accent);
        accentPainters.add(() -> ic.setColorFilter(accent));
        panel.addView(ic, new LinearLayout.LayoutParams(d(56), d(56)));
        TextView title = text(48, serif(500), TEXT);
        title.setTag("title");
        panel.addView(title, llp(-2, -2, 0, d(20), 0, d(20)));
        TextView steps = text(26, sans(400), TEXT_2);
        steps.setLineSpacing(d(12), 1f);
        steps.setTag("steps");
        panel.addView(steps, new LinearLayout.LayoutParams(-2, -2));
        TextView ok = text(24, sans(700), 0xFF111111);
        ok.setText("OK");
        ok.setGravity(Gravity.CENTER);
        ok.setFocusable(true);
        GradientDrawable okBg = new GradientDrawable();
        okBg.setCornerRadius(d(26));
        okBg.setColor(accent);
        accentPainters.add(() -> okBg.setColor(accent));
        ok.setBackground(okBg);
        ok.setOnClickListener(v -> hideCast());
        ok.setTag("ok");
        panel.addView(ok, llp(d(200), d(56), 0, d(40), 0, 0));
        layer.addView(panel, new FrameLayout.LayoutParams(d(980), -2, Gravity.CENTER));
        return layer;
    }

    private void showCast() {
        String device = Settings.Global.getString(getContentResolver(), "device_name");
        if (TextUtils.isEmpty(device)) device = android.os.Build.MODEL;
        String ssid = wifiSsid();
        ((TextView) castLayer.findViewWithTag("title")).setText(t("Cast from your phone", "Cast dari ponsel Anda"));
        String step1 = ssid != null
                ? t("1.  Connect your phone to the Wi-Fi “" + ssid + "”.", "1.  Sambungkan ponsel ke Wi-Fi “" + ssid + "”.")
                : t("1.  Connect your phone to the hotel Wi-Fi.", "1.  Sambungkan ponsel ke Wi-Fi hotel.");
        ((TextView) castLayer.findViewWithTag("steps")).setText(step1 + "\n"
                + t("2.  Open YouTube, Netflix, Spotify or another app and tap the Cast icon.",
                    "2.  Buka YouTube, Netflix, Spotify atau aplikasi lain, lalu ketuk ikon Cast.") + "\n"
                + t("3.  Choose “" + device + "”.", "3.  Pilih “" + device + "”."));
        castLayer.setVisibility(View.VISIBLE);
        castLayer.findViewWithTag("ok").requestFocus();
    }

    private void hideCast() {
        if (castLayer == null || castLayer.getVisibility() != View.VISIBLE) return;
        castLayer.setVisibility(View.GONE);
        restoreFocus();
    }

    private TextView pill(int iconRes) {
        TextView p = text(22, sans(500), 0xF2FFFFFF);
        p.setGravity(Gravity.CENTER_VERTICAL);
        p.setPadding(d(24), 0, d(26), 0);
        p.setFocusable(true);
        p.setId(View.generateViewId());
        Drawable ic = getDrawable(iconRes).mutate();
        ic.setBounds(0, 0, d(26), d(26));
        ic.setTint(0xF2FFFFFF);
        p.setCompoundDrawables(ic, null, null, null);
        p.setCompoundDrawablePadding(d(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(26));
        bg.setColor(0x8C1A1D22);
        bg.setStroke(Math.max(1, d(1.5f)), 0x33FFFFFF);
        p.setBackground(bg);
        p.setOnFocusChangeListener((v, has) -> {
            bg.setColor(has ? 0xF2FFFFFF : 0x8C1A1D22);
            p.setTextColor(has ? 0xFF111111 : 0xF2FFFFFF);
            ic.setTint(has ? 0xFF111111 : 0xF2FFFFFF);
            v.animate().scaleX(has ? 1.06f : 1f).scaleY(has ? 1.06f : 1f).setDuration(180).start();
            if (has) lastFocusedId = v.getId();
        });
        return p;
    }

    // ---------------------------------------------------------------- Watch row

    static final class App {
        String pkg, label;
        ComponentName component;
        Drawable art;
        boolean isBanner;
    }

    private void buildWatchRow() {
        PackageManager pm = getPackageManager();
        android.content.pm.ChangedPackages changed = pm.getChangedPackages(packageSeq);
        if (changed != null) packageSeq = changed.getSequenceNumber();
        Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        Map<String, App> byPkg = new HashMap<>();
        for (ResolveInfo ri : pm.queryIntentActivities(q, 0)) {
            ActivityInfo ai = ri.activityInfo;
            if (byPkg.containsKey(ai.packageName)) continue;
            App a = new App();
            a.pkg = ai.packageName;
            a.label = String.valueOf(ri.loadLabel(pm));
            a.component = new ComponentName(ai.packageName, ai.name);
            Drawable banner = ai.loadBanner(pm);
            if (banner == null) banner = ai.applicationInfo.loadBanner(pm);
            a.isBanner = banner != null;
            a.art = banner != null ? banner : ri.loadIcon(pm);
            byPkg.put(a.pkg, a);
        }
        List<App> apps = new ArrayList<>();
        for (String p : watchApps) if (byPkg.containsKey(p)) apps.add(byPkg.get(p));

        watchRow.removeAllViews();
        watchCards.clear();
        int n = apps.size() + 1; // + Cast from phone
        for (int i = 0; i < n; i++) {
            View tile = i < apps.size() ? appTile(apps.get(i)) : castTile();
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -1, 1f);
            p.setMargins(i == 0 ? 0 : d(11), 0, i == n - 1 ? 0 : d(11), 0);
            watchRow.addView(tile, p);
        }
        wireFocus();
        restoreFocus();
    }

    private View appTile(App app) {
        FrameLayout card = new FrameLayout(this);
        card.setId(View.generateViewId());
        card.setFocusable(true);
        card.setClickable(true);
        card.setClipToOutline(true);
        card.setOutlineProvider(rounded(18));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(18));
        bg.setColor(0xE615181D);
        bg.setStroke(Math.max(1, d(1.5f)), 0x1FFFFFFF);
        card.setBackground(bg);
        if (app.art != null) {
            ImageView img = new ImageView(this);
            img.setImageDrawable(app.art);
            if (app.isBanner) {
                img.setScaleType(ImageView.ScaleType.CENTER_CROP);
                card.addView(img, new FrameLayout.LayoutParams(-1, -1));
            } else {
                img.setScaleType(ImageView.ScaleType.FIT_CENTER);
                img.setPadding(d(40), d(24), d(40), d(24));
                card.addView(img, new FrameLayout.LayoutParams(-1, -1));
            }
        } else {
            TextView label = text(26, sans(600), TEXT);
            label.setText(app.label);
            label.setGravity(Gravity.CENTER);
            card.addView(label, new FrameLayout.LayoutParams(-1, -1));
        }
        addRing(card, 18);
        card.setOnClickListener(v -> launch(new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
                .setComponent(app.component)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)));
        watchCards.add(card);
        return card;
    }

    private View castTile() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        card.setId(View.generateViewId());
        card.setFocusable(true);
        card.setClickable(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(18));
        bg.setColor(0x26000000);
        bg.setStroke(Math.max(1, d(1.5f)), 0x59FFFFFF, d(6), d(5));
        card.setBackground(bg);
        card.addView(icon(R.drawable.ic_cast, TEXT), new LinearLayout.LayoutParams(d(30), d(30)));
        TextView label = text(23, sans(500), TEXT);
        label.setTag("cast_label");
        label.setText(t("Cast from phone", "Cast dari ponsel"));
        label.setGravity(Gravity.CENTER);
        card.addView(label, llp(-2, -2, 0, d(10), 0, 0));
        FrameLayout wrap = new FrameLayout(this);
        wrap.setClipChildren(false);
        // The ring needs a frame to draw over the tile; the wrap is what takes focus.
        wrap.addView(card, new FrameLayout.LayoutParams(-1, -1));
        wrap.setId(View.generateViewId());
        wrap.setFocusable(true);
        wrap.setClickable(true);
        card.setFocusable(false);
        card.setClickable(false);
        addRing(wrap, 18);
        wrap.setOnClickListener(v -> showCast());
        watchCards.add(wrap);
        return wrap;
    }

    // ---------------------------------------------------------------- At <hotel> row

    private static final class InfoTile {
        final int icon, tint; final String en, id, subEn, subId, path;
        InfoTile(int icon, int tint, String en, String id, String subEn, String subId, String path) {
            this.icon = icon; this.tint = tint; this.en = en; this.id = id;
            this.subEn = subEn; this.subId = subId; this.path = path;
        }
    }

    private void buildZahillRow() {
        String hotel = hotelShortName();
        List<InfoTile> tiles = new ArrayList<>();
        tiles.add(new InfoTile(R.drawable.ic_dining, accent, "Dining & Menu", "Makan & Menu",
                "Restaurant · Room service", "Restoran · Layanan kamar", "/info/dining"));
        if (state == null || state.optBoolean("activitiesEnabled", true)) {
            tiles.add(new InfoTile(R.drawable.ic_activities, 0xFF7FB98A, "Activities", "Aktivitas",
                    "Tours · Experiences", "Tur · Pengalaman", "/info/activities"));
        }
        tiles.add(new InfoTile(R.drawable.ic_guide, 0xFF8FA8E6, "Hotel Guide", "Panduan Hotel",
                "Facilities · Hours · Contacts", "Fasilitas · Jam · Kontak", "/info/guide"));
        tiles.add(new InfoTile(R.drawable.ic_today, 0xFFE0907A,
                "Today at " + hotel, "Hari ini di " + hotel,
                "Events · Notices", "Acara · Pengumuman", "/info/today"));

        zahillRow.removeAllViews();
        zahillCards.clear();
        for (int i = 0; i < tiles.size(); i++) {
            View v = infoTile(tiles.get(i));
            zahillRow.addView(v, llp(d(404), -1, i == 0 ? 0 : d(22), 0, 0, 0));
        }
        wireFocus();
    }

    private View infoTile(InfoTile t) {
        FrameLayout card = new FrameLayout(this);
        card.setId(View.generateViewId());
        card.setFocusable(true);
        card.setClickable(true);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{withAlpha(t.tint, 0.30f), 0xE6141619, 0xF00F1114});
        bg.setCornerRadius(d(18));
        bg.setStroke(Math.max(1, d(1.5f)), withAlpha(t.tint, 0.35f));
        card.setBackground(bg);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(d(28), d(20), d(24), d(16));
        col.addView(icon(t.icon, t.tint), new LinearLayout.LayoutParams(d(30), d(30)));
        TextView title = text(32, sans(700), TEXT);
        title.setText(t(t.en, t.id));
        title.setSingleLine(true);
        title.setIncludeFontPadding(false);
        title.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(title, llp(-1, -2, 0, d(10), 0, 0));
        TextView sub = text(20, sans(400), TEXT_2);
        sub.setText(t(t.subEn, t.subId));
        sub.setSingleLine(true);
        sub.setIncludeFontPadding(false);
        sub.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(sub, llp(-1, -2, 0, d(6), 0, 0));
        card.addView(col, new FrameLayout.LayoutParams(-1, -1));
        addRing(card, 18);
        card.setOnClickListener(v -> {
            Intent i = new Intent(this, HotelInfoActivity.class)
                    .putExtra(HotelInfoActivity.EXTRA_PATH, t.path)
                    .putExtra(HotelInfoActivity.EXTRA_LANG, lang);
            launch(i);
        });
        zahillCards.add(card);
        return card;
    }

    /** Accent focus ring drawn over a tile; the tile also grows a little. */
    private void addRing(FrameLayout card, int radius) {
        View ring = new View(this);
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(d(radius));
        g.setStroke(d(4), accent);
        ring.setBackground(g);
        ring.setAlpha(0f);
        accentPainters.add(() -> g.setStroke(d(4), accent));
        card.addView(ring, new FrameLayout.LayoutParams(-1, -1));
        card.setOnFocusChangeListener((v, has) -> {
            v.animate().scaleX(has ? 1.06f : 1f).scaleY(has ? 1.06f : 1f).translationZ(has ? d(16) : 0)
                    .setInterpolator(new DecelerateInterpolator()).setDuration(has ? 220 : 160).start();
            ring.animate().alpha(has ? 1f : 0f).setDuration(140).start();
            if (has) lastFocusedId = v.getId();
        });
    }

    /** Explicit D-pad targets: pills ↔ Watch row ↔ At-hotel row; row ends don't wrap. */
    private void wireFocus() {
        int w = watchCards.size(), z = zahillCards.size();
        if (pills.isEmpty()) return;
        int pillTarget = w > 0 ? watchCards.get(w - 1).getId() : (z > 0 ? zahillCards.get(z - 1).getId() : View.NO_ID);
        for (int i = 0; i < pills.size(); i++) {
            View p = pills.get(i);
            p.setNextFocusLeftId(i == 0 ? p.getId() : pills.get(i - 1).getId());
            p.setNextFocusRightId(i == pills.size() - 1 ? p.getId() : pills.get(i + 1).getId());
            p.setNextFocusUpId(p.getId());
            p.setNextFocusDownId(pillTarget == View.NO_ID ? p.getId() : pillTarget);
        }
        int lastPill = pills.get(pills.size() - 1).getId();
        for (int i = 0; i < w; i++) {
            View c = watchCards.get(i);
            c.setNextFocusUpId(lastPill);
            c.setNextFocusLeftId(i == 0 ? c.getId() : watchCards.get(i - 1).getId());
            c.setNextFocusRightId(i == w - 1 ? c.getId() : watchCards.get(i + 1).getId());
            int zi = z == 0 ? -1 : Math.min(z - 1, Math.round(i * (z - 1) / (float) Math.max(1, w - 1)));
            c.setNextFocusDownId(zi < 0 ? c.getId() : zahillCards.get(zi).getId());
        }
        for (int j = 0; j < z; j++) {
            View c = zahillCards.get(j);
            int wi = w == 0 ? -1 : Math.min(w - 1, Math.round(j * (w - 1) / (float) Math.max(1, z - 1)));
            c.setNextFocusUpId(wi < 0 ? lastPill : watchCards.get(wi).getId());
            c.setNextFocusDownId(c.getId());
            c.setNextFocusLeftId(j == 0 ? c.getId() : zahillCards.get(j - 1).getId());
            c.setNextFocusRightId(j == z - 1 ? c.getId() : zahillCards.get(j + 1).getId());
        }
    }

    private void restoreFocus() {
        if (vacantLayer != null && vacantLayer.getVisibility() == View.VISIBLE) return;
        if (castLayer != null && castLayer.getVisibility() == View.VISIBLE) return;
        View last = lastFocusedId == View.NO_ID ? null : findViewById(lastFocusedId);
        if (last == null && !watchCards.isEmpty()) last = watchCards.get(0);
        if (last == null && !zahillCards.isEmpty()) last = zahillCards.get(0);
        if (last != null) last.requestFocus();
    }

    // ---------------------------------------------------------------- PMS state

    private void loadState() {
        handler.removeCallbacks(refresh);
        handler.postDelayed(refresh, REFRESH_MS);
        if (!PmsClient.configured(this)) {
            if (state != null) { state = null; applyState(false); }
            return;
        }
        net.execute(() -> {
            try {
                String json = PmsClient.fetchState(this);
                JSONObject fresh = new JSONObject(json);
                prefs.edit().putString(Preferences.KEY_LAST_STATE, json).apply();
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    state = fresh;
                    applyState(false);
                });
            } catch (Exception e) {
                android.util.Log.w("ZahillTV", "state: " + e.getMessage());
            }
        });
    }

    /** Put the state on screen. `first` = drawn at start (maybe from the saved copy). */
    private void applyState(boolean first) {
        JSONObject property = state == null ? null : state.optJSONObject("property");
        JSONObject unit = state == null ? null : state.optJSONObject("unit");
        JSONObject booking = state == null ? null : state.optJSONObject("booking");
        JSONObject tv = state == null ? null : state.optJSONObject("tv");

        int newAccent = readableAccent(property == null ? null : property.optString("brand_color", null));
        if (tv != null && !tv.isNull("accent")) newAccent = readableAccent(tv.optString("accent", null));
        if (newAccent != accent) {
            accent = newAccent;
            for (Runnable r : accentPainters) r.run();
        }

        // Logo, or the hotel's name when it has none.
        String newLogo = property == null ? null : PmsClient.resolve(this, nullIfEmpty(property.optString("logo_url", null)));
        String hotelName = property == null ? null : nullIfEmpty(property.optString("name", null));
        if (newLogo == null) {
            logoView.setImageDrawable(null);
            vacantLogo.setImageDrawable(null);
            logoUrl = null;
            showLogoText(hotelName);
        } else if (!newLogo.equals(logoUrl)) {
            logoUrl = newLogo;
            loadLogo(newLogo, hotelName);
        }

        // Weather: "19°C  Kintamani · Cloudy"
        JSONObject weather = state == null ? null : state.optJSONObject("weather");
        JSONObject today = weather == null ? null : weather.optJSONObject("today");
        if (today != null && today.has("temp")) {
            String area = property == null ? "" : property.optString("location", "");
            int comma = area.indexOf(',');
            if (comma > 0) area = area.substring(0, comma);
            StringBuilder sb = new StringBuilder();
            sb.append(today.optString("temp")).append("°C");
            String descr = today.optString("desc", "");
            String rest = (area.trim().isEmpty() ? "" : area.trim()) + (descr.isEmpty() ? "" : (area.trim().isEmpty() ? "" : " · ") + descr);
            weatherText.setText(rest.isEmpty() ? sb : sb + "   " + rest);
            weatherRow.setVisibility(View.VISIBLE);
        } else {
            weatherRow.setVisibility(View.GONE);
        }

        // Welcome block
        String roomLine = roomLine(unit);
        chipsRow.removeAllViews();
        if (!PmsClient.configured(this)) {
            eyebrow.setText(t("SET UP THIS TV", "ATUR TV INI"));
            nameText.setText(t("Hold OK for 3 seconds", "Tahan OK 3 detik"));
            roomText.setText(t("to enter the Room ID and display token", "untuk mengisi Room ID dan token tampilan"));
        } else if (booking != null) {
            eyebrow.setText("SELAMAT DATANG  ·  WELCOME");
            nameText.setText(booking.optString("guest_name", ""));
            roomText.setText(roomLine);
            String out = formatDay(booking.optString("check_out_date", ""));
            if (out != null) {
                String time = tv == null ? null : nullIfEmpty(tv.optString("checkout_time", null));
                addChip(t("CHECK-OUT", "CHECK-OUT"), time == null ? out : out + " · " + time);
            }
            addWifiChip(tv);
            JSONObject bf = tv == null ? null : tv.optJSONObject("breakfast");
            if (bf != null && nullIfEmpty(bf.optString("hours", null)) != null) {
                String outlet = nullIfEmpty(bf.optString("outlet", null));
                addChip(t("BREAKFAST", "SARAPAN"), bf.optString("hours") + (outlet == null ? "" : " · " + outlet));
            }
        } else {
            eyebrow.setText("SELAMAT DATANG  ·  WELCOME");
            nameText.setText(t("Welcome to your room", "Selamat datang di kamar Anda"));
            roomText.setText(roomLine);
            addWifiChip(tv);
        }
        chipsRow.setVisibility(chipsRow.getChildCount() == 0 ? View.GONE : View.VISIBLE);

        watchLabel.setText(t("WATCH", "TONTON"));
        zahillLabel.setText(t("AT ", "DI ") + hotelShortName().toUpperCase(locale()));
        View castLabel = watchRow.findViewWithTag("cast_label");
        if (castLabel != null) ((TextView) castLabel).setText(t("Cast from phone", "Cast dari ponsel"));
        ((TextView) pills.get(0)).setText(t("Inputs", "Input"));
        buildZahillRow();
        updateClock();

        // Vacant card texts
        vacantTitle.setText(t("Welcome to your room", "Selamat datang di kamar Anda"));
        vacantRoom.setText(roomLine.toUpperCase(locale()));
        vacantRoom.setVisibility(roomLine.isEmpty() ? View.GONE : View.VISIBLE);
        vacantReady.setText(t("READY FOR GUESTS", "SIAP UNTUK TAMU"));
        vacantPress.setText(t("Press", "Tekan"));
        ((TextView) ((View) vacantPress.getParent()).getTag()).setText(t("to start watching", "untuk mulai menonton"));
        JSONObject wifi = tv == null ? null : tv.optJSONObject("wifi");
        String wifiLine = wifiLine(wifi);
        vacantWifi.setText(wifiLine == null ? "" : "Wi-Fi  " + wifiLine);

        // An empty room shows the welcome card: at start, and whenever the guest has just left.
        boolean vacant = PmsClient.configured(this) && state != null && booking == null;
        if (vacant && (first || !wasVacant)) showVacant();
        if (!vacant) hideVacant(false);
        wasVacant = vacant;

        // Background: Guest Board photos, or the built-in one.
        List<String> urls = new ArrayList<>();
        JSONArray cards = state == null ? null : state.optJSONArray("cards");
        JSONArray tvBgs = tv == null ? null : tv.optJSONArray("background_urls");
        JSONArray source = tvBgs != null ? tvBgs : cards;
        if (source != null) for (int i = 0; i < source.length(); i++) {
            String u = source == tvBgs ? source.optString(i, null)
                    : (source.optJSONObject(i) == null ? null : source.optJSONObject(i).optString("image_url", null));
            u = PmsClient.resolve(this, nullIfEmpty(u));
            if (u != null && !urls.contains(u)) urls.add(u);
        }
        if (!urls.equals(bgUrls)) {
            bgUrls = urls;
            bgIndex = -1;
            nextBackground();
        }
    }

    private void addWifiChip(JSONObject tv) {
        String line = wifiLine(tv == null ? null : tv.optJSONObject("wifi"));
        if (line != null) addChip("WI-FI", line);
    }

    private static String wifiLine(JSONObject wifi) {
        if (wifi == null) return null;
        String ssid = nullIfEmpty(wifi.optString("ssid", null));
        if (ssid == null) return null;
        String pass = nullIfEmpty(wifi.optString("password", null));
        return pass == null ? ssid : ssid + " · " + pass;
    }

    private void addChip(String label, String value) {
        LinearLayout chip = new LinearLayout(this);
        chip.setOrientation(LinearLayout.VERTICAL);
        chip.setPadding(d(26), d(22), d(30), d(22));
        chip.setMinimumWidth(d(240));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(16));
        bg.setColor(0x73141619);
        bg.setStroke(Math.max(1, d(1.5f)), 0x24FFFFFF);
        chip.setBackground(bg);
        TextView l = text(15, sans(700), LABEL);
        l.setLetterSpacing(0.22f);
        l.setText(label);
        chip.addView(l);
        TextView v = text(27, sans(500), TEXT);
        v.setText(value);
        v.setMaxWidth(d(420));
        v.setMaxLines(2);
        v.setEllipsize(TextUtils.TruncateAt.END);
        chip.addView(v, llp(-2, -2, 0, d(10), 0, 0));
        chipsRow.addView(chip, llp(-2, -2, chipsRow.getChildCount() == 0 ? 0 : d(16), 0, 0, 0));
    }

    private String roomLine(JSONObject unit) {
        if (unit == null) return "";
        String name = unit.optString("name", "").trim();
        String type = nullIfEmpty(unit.optString("type", null));
        String room = name.isEmpty() ? "" : (name.toLowerCase(Locale.ROOT).startsWith("room") || name.toLowerCase(Locale.ROOT).startsWith("kamar")
                ? name : t("Room ", "Kamar ") + name);
        if (type == null) return room;
        return room.isEmpty() ? type : room + " · " + type;
    }

    private String hotelShortName() {
        JSONObject property = state == null ? null : state.optJSONObject("property");
        String name = property == null ? null : nullIfEmpty(property.optString("name", null));
        if (name == null) return t("the hotel", "hotel");
        return name.trim().split("\\s+")[0];
    }

    private void showLogoText(String name) {
        logoView.setVisibility(View.GONE);
        vacantLogo.setVisibility(View.GONE);
        logoText.setText(name == null ? "" : name);
        vacantLogoText.setText(name == null ? "" : name);
        logoText.setVisibility(name == null ? View.GONE : View.VISIBLE);
        vacantLogoText.setVisibility(name == null ? View.GONE : View.VISIBLE);
    }

    private void showLogo(Bitmap bm) {
        logoView.setImageBitmap(bm);
        vacantLogo.setImageBitmap(bm);
        logoView.setVisibility(View.VISIBLE);
        vacantLogo.setVisibility(View.VISIBLE);
        logoText.setVisibility(View.GONE);
        vacantLogoText.setVisibility(View.GONE);
    }

    /** The logo, kept on the TV once downloaded so it shows at boot without network. */
    private void loadLogo(String url, String fallbackName) {
        File file = new File(getFilesDir(), "logo-" + Integer.toHexString(url.hashCode()) + ".img");
        if (file.exists()) {
            Bitmap bm = BitmapFactory.decodeFile(file.getPath());
            if (bm != null) { showLogo(bm); return; }
        }
        showLogoText(fallbackName);
        net.execute(() -> {
            try {
                byte[] bytes = PmsClient.download(url);
                Bitmap bm = PmsClient.decode(bytes, d(640), false);
                if (bm == null) return;
                try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                runOnUiThread(() -> { if (url.equals(logoUrl)) showLogo(bm); });
            } catch (Exception e) {
                android.util.Log.w("ZahillTV", "logo: " + e.getMessage());
            }
        });
    }

    // ---------------------------------------------------------------- vacant room card

    private void showVacant() {
        if (inputsPopup != null) inputsPopup.dismiss();
        vacantLayer.setVisibility(View.VISIBLE);
        vacantLayer.setAlpha(0f);
        vacantLayer.animate().alpha(1f).setDuration(400).start();
        homeLayer.setVisibility(View.INVISIBLE);
        ((View) logoView.getParent()).setVisibility(View.INVISIBLE);
        pillsRow.setVisibility(View.INVISIBLE);
        View f = getCurrentFocus();
        if (f != null) f.clearFocus();
    }

    private void hideVacant(boolean animate) {
        if (vacantLayer.getVisibility() != View.VISIBLE) return;
        vacantLayer.setVisibility(View.GONE);
        homeLayer.setVisibility(View.VISIBLE);
        ((View) logoView.getParent()).setVisibility(View.VISIBLE);
        pillsRow.setVisibility(View.VISIBLE);
        if (animate) {
            homeLayer.setAlpha(0f);
            homeLayer.animate().alpha(1f).setDuration(350).start();
        }
        if (!watchCards.isEmpty()) watchCards.get(0).requestFocus();
        else restoreFocus();
    }

    // ---------------------------------------------------------------- background

    private ImageView photoLayer() {
        ImageView v = new ImageView(this);
        v.setScaleType(ImageView.ScaleType.CENTER_CROP);
        return v;
    }

    /** Next Guest Board photo (or the built-in one), loaded off the main thread, then crossfaded in. */
    private void nextBackground() {
        handler.removeCallbacks(rotateBg);
        final String key;
        if (bgUrls.isEmpty()) {
            key = "asset:hero.jpg";
        } else {
            bgIndex = (bgIndex + 1) % bgUrls.size();
            key = bgUrls.get(bgIndex);
            if (bgUrls.size() > 1) scheduleBg(BG_ROTATE_MS);
        }
        if (key.equals(shownBg)) return;
        Bitmap cached = images.get(key);
        if (cached != null) { showBackground(key, cached); return; }
        int width = getResources().getDisplayMetrics().widthPixels;
        net.execute(() -> {
            Bitmap bm = null;
            try {
                if (key.startsWith("asset:")) {
                    try (java.io.InputStream in = getAssets().open(key.substring(6))) {
                        bm = PmsClient.decode(PmsClient.readAll(in), width, true);
                    }
                } else {
                    bm = PmsClient.decode(PmsClient.download(key), width, true);
                }
            } catch (Exception e) {
                android.util.Log.w("ZahillTV", "background " + key + ": " + e.getMessage());
            }
            Bitmap result = bm;
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                if (result != null) { images.put(key, result); showBackground(key, result); }
                else if (shownBg == null) { bgUrls = new ArrayList<>(); nextBackground(); }
            });
        });
    }

    private void showBackground(String key, Bitmap bm) {
        boolean firstOne = shownBg == null;
        shownBg = key;
        // Swap roles: the old front becomes the back, the new photo fades in on top.
        ImageView old = wallFront;
        wallFront = wallBack;
        wallBack = old;
        root.removeView(wallFront);
        root.addView(wallFront, 1, new FrameLayout.LayoutParams(-1, -1));
        wallFront.setImageBitmap(bm);
        wallFront.setAlpha(0f);
        wallFront.animate().alpha(1f).setDuration(firstOne ? 500 : 1800)
                .withEndAction(() -> wallBack.setImageDrawable(null)).start();
    }

    private void scheduleBg(long delay) {
        handler.removeCallbacks(rotateBg);
        handler.postDelayed(rotateBg, delay);
    }

    // ---------------------------------------------------------------- inputs (from tv-home)

    private void showInputs(View anchor) {
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(d(12), d(12), d(12), d(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(20));
        bg.setColor(0xF2151820);
        bg.setStroke(Math.max(1, d(1.5f)), 0x26FFFFFF);
        list.setBackground(bg);

        PopupWindow pw = new PopupWindow(list, d(340), -2, true);
        List<TextView> rows = new ArrayList<>();
        TvInputManager tim = (TvInputManager) getSystemService(TV_INPUT_SERVICE);
        List<TvInputInfo> inputs = new ArrayList<>();
        if (tim != null) for (TvInputInfo ti : tim.getTvInputList()) {
            if (ti.isPassthroughInput() && !ti.isHidden(this)) inputs.add(ti);
        }
        Collections.sort(inputs, (x, y) -> inputLabel(x).compareToIgnoreCase(inputLabel(y)));
        for (TvInputInfo ti : inputs) {
            rows.add(inputRow(inputLabel(ti), () -> {
                Intent i = new Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(ti.getId()));
                if (!launch(i)) openPackage(inputPickerPkg);
            }));
        }
        if (isInstalled(liveTvPkg)) rows.add(inputRow(t("Live TV", "TV Siaran"), () -> openPackage(liveTvPkg)));
        if (inputs.isEmpty() && isInstalled(inputPickerPkg) && !inputPickerPkg.equals(liveTvPkg)) {
            rows.add(inputRow(t("All sources…", "Semua sumber…"), () -> openPackage(inputPickerPkg)));
        }
        if (rows.isEmpty()) rows.add(inputRow(t("Settings", "Pengaturan"), () -> launch(new Intent(Settings.ACTION_SETTINGS))));
        for (TextView r : rows) {
            r.setOnClickListener(v -> { pw.dismiss(); ((Runnable) v.getTag()).run(); });
            list.addView(r, new LinearLayout.LayoutParams(-1, d(60)));
        }
        for (int i = 0; i < rows.size(); i++) {
            TextView r = rows.get(i);
            r.setNextFocusUpId(rows.get(Math.max(0, i - 1)).getId());
            r.setNextFocusDownId(rows.get(Math.min(rows.size() - 1, i + 1)).getId());
            r.setNextFocusLeftId(r.getId());
            r.setNextFocusRightId(r.getId());
        }
        pw.setOutsideTouchable(true);
        pw.setElevation(d(16));
        pw.setOnDismissListener(() -> { inputsPopup = null; anchor.requestFocus(); });
        inputsPopup = pw;
        pw.showAsDropDown(anchor, 0, d(12), Gravity.START);
        rows.get(0).requestFocus();
    }

    private String inputLabel(TvInputInfo ti) {
        CharSequence c = ti.loadCustomLabel(this);
        if (c == null || c.length() == 0) c = ti.loadLabel(this);
        return String.valueOf(c);
    }

    private TextView inputRow(String label, Runnable action) {
        TextView r = text(24, sans(500), TEXT);
        r.setText(label);
        r.setTag(action);
        r.setId(View.generateViewId());
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(d(22), 0, d(22), 0);
        r.setFocusable(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(d(12));
        bg.setColor(Color.TRANSPARENT);
        r.setBackground(bg);
        r.setOnFocusChangeListener((v, has) -> {
            bg.setColor(has ? 0xF2FFFFFF : Color.TRANSPARENT);
            r.setTextColor(has ? 0xFF111111 : TEXT);
        });
        return r;
    }

    // ---------------------------------------------------------------- language, clock

    private void toggleLanguage() {
        lang = "en".equals(lang) ? "id" : "en";
        prefs.edit().putString(Preferences.KEY_LANG, lang).apply();
        int focused = lastFocusedId;
        applyState(false);
        lastFocusedId = focused;
        View pill = pills.get(1);
        pill.requestFocus();
    }

    private String t(String en, String id) {
        return "id".equals(lang) ? id : en;
    }

    private Locale locale() {
        return "id".equals(lang) ? Locale.forLanguageTag("id-ID") : Locale.UK;
    }

    private void updateClock() {
        Date now = new Date();
        SimpleDateFormat hm = new SimpleDateFormat("hh:mm", Locale.US);
        hm.setTimeZone(HOTEL_TZ);
        clock.setText(hm.format(now));
        Calendar c = Calendar.getInstance(HOTEL_TZ);
        ampm.setText(c.get(Calendar.HOUR_OF_DAY) < 12 ? "AM" : "PM");
        SimpleDateFormat df = new SimpleDateFormat("EEEE, d MMMM", locale());
        df.setTimeZone(HOTEL_TZ);
        date.setText(df.format(now).toUpperCase(locale()));
    }

    /** "2026-10-31" → "Fri, 31 Oct". */
    private String formatDay(String ymd) {
        if (ymd == null || ymd.length() < 10) return null;
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            in.setTimeZone(HOTEL_TZ);
            Date day = in.parse(ymd.substring(0, 10));
            SimpleDateFormat out = new SimpleDateFormat("EEE, d MMM", locale());
            out.setTimeZone(HOTEL_TZ);
            return out.format(day);
        } catch (ParseException e) {
            return null;
        }
    }

    private String wifiSsid() {
        JSONObject tv = state == null ? null : state.optJSONObject("tv");
        JSONObject wifi = tv == null ? null : tv.optJSONObject("wifi");
        return wifi == null ? null : nullIfEmpty(wifi.optString("ssid", null));
    }

    // ---------------------------------------------------------------- keys

    private static boolean isOk(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER;
    }

    private static boolean isVolume(int code) {
        return code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN
                || code == KeyEvent.KEYCODE_VOLUME_MUTE;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        // Hold OK 3 s: the settings (Room ID / token) — for staff, not obvious to guests.
        if (isOk(code)) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) {
                if (e.getRepeatCount() == 0) { okHeld = true; settingsOpened = false; }
                else {
                    if (okHeld && !settingsOpened && e.getEventTime() - e.getDownTime() >= HOLD_FOR_SETTINGS_MS) {
                        settingsOpened = true;
                        startActivity(new Intent(this, SettingsActivity.class));
                    }
                    return true; // a held OK neither repeats nor long-presses a tile
                }
            } else if (e.getAction() == KeyEvent.ACTION_UP) {
                boolean opened = settingsOpened;
                okHeld = false;
                settingsOpened = false;
                if (opened) return true;
            }
        }
        // Empty room card: any button (but volume) goes on to the Home rows.
        if (vacantLayer.getVisibility() == View.VISIBLE && !isVolume(code)) {
            if (e.getAction() == KeyEvent.ACTION_UP) hideVacant(true);
            return true;
        }
        // Menu key on the remote opens the Inputs list.
        if (code == KeyEvent.KEYCODE_MENU && e.getAction() == KeyEvent.ACTION_UP && castLayer.getVisibility() != View.VISIBLE) {
            showInputs(pills.get(0));
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    // ---------------------------------------------------------------- helpers

    private boolean launch(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private boolean isInstalled(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private void openPackage(String pkg) {
        Intent i = getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i != null) launch(i);
    }

    /** brand_color as the accent; a very dark colour is lightened so focus rings stay visible. */
    private static int readableAccent(String hex) {
        int c;
        try {
            c = hex == null || hex.trim().isEmpty() ? DEFAULT_ACCENT : Color.parseColor(hex.trim());
        } catch (IllegalArgumentException e) {
            c = DEFAULT_ACCENT;
        }
        c = c | 0xFF000000;
        for (int i = 0; i < 10 && Color.luminance(c) < 0.28f; i++) {
            c = Color.rgb(Color.red(c) + (255 - Color.red(c)) / 5,
                    Color.green(c) + (255 - Color.green(c)) / 5,
                    Color.blue(c) + (255 - Color.blue(c)) / 5);
        }
        return c;
    }

    private Typeface font(String file, int weight) {
        String key = file + weight;
        Typeface tf = fonts.get(key);
        if (tf == null) {
            try {
                tf = new Typeface.Builder(getAssets(), "fonts/" + file)
                        .setFontVariationSettings("'wght' " + weight).build();
            } catch (RuntimeException e) {
                tf = null;
            }
            if (tf == null) tf = Typeface.create(file.startsWith("Cormorant") ? "serif" : "sans-serif",
                    weight >= 600 ? Typeface.BOLD : Typeface.NORMAL);
            fonts.put(key, tf);
        }
        return tf;
    }

    private Typeface sans(int weight) { return font("Manrope.ttf", weight); }

    private Typeface serif(int weight) { return font("CormorantGaramond.ttf", weight); }

    private TextView text(float designPx, Typeface tf, int color) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, designPx * s);
        t.setTypeface(tf);
        t.setTextColor(color);
        return t;
    }

    private ImageView icon(int res, int tint) {
        ImageView v = new ImageView(this);
        v.setImageResource(res);
        v.setColorFilter(tint);
        v.setScaleType(ImageView.ScaleType.FIT_CENTER);
        return v;
    }

    private ViewOutlineProvider rounded(int radius) {
        return new ViewOutlineProvider() {
            @Override public void getOutline(View v, Outline o) {
                o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), d(radius));
            }
        };
    }

    /** Design pixels → screen pixels. */
    private int d(float designPx) {
        return Math.round(designPx * s);
    }

    private static String nullIfEmpty(String v) {
        return v == null || v.trim().isEmpty() || "null".equals(v) ? null : v;
    }

    private static FrameLayout.LayoutParams lp(int w, int h, int gravity, int l, int t, int r, int b) {
        FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(w, h, gravity);
        p.setMargins(l, t, r, b);
        return p;
    }

    private static LinearLayout.LayoutParams llp(int w, int h, int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.setMargins(l, t, r, b);
        return p;
    }

    private static int withAlpha(int c, float a) {
        return Color.argb(Math.round(a * 255), Color.red(c), Color.green(c), Color.blue(c));
    }
}
