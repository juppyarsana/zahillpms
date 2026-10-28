package com.zahill.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Talks to the PMS through the TV host (the same address the screensaver page uses):
 * GET /api/display/room/:roomId/state with the property's display token, and the
 * pictures it names (/property-logos/…, /board-images/…). Blocking calls — run off the
 * main thread.
 */
final class PmsClient {
    private PmsClient() { }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(c.getPackageName(), Context.MODE_PRIVATE);
    }

    static boolean configured(Context c) {
        SharedPreferences p = prefs(c);
        return !isBlank(p.getString(Preferences.KEY_ROOM_ID, null))
                && !isBlank(p.getString(Preferences.KEY_DISPLAY_TOKEN, null));
    }

    static String baseUrl(Context c) {
        String b = prefs(c).getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL);
        if (isBlank(b)) b = Preferences.DEFAULT_BASE_URL;
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        return b;
    }

    /** The room's state JSON as text. Throws on no network or any non-200 answer. */
    static String fetchState(Context c) throws IOException {
        SharedPreferences p = prefs(c);
        String room = p.getString(Preferences.KEY_ROOM_ID, "");
        String token = p.getString(Preferences.KEY_DISPLAY_TOKEN, "");
        URL url = new URL(baseUrl(c) + "/api/display/room/" + Uri.encode(room) + "/state");
        HttpURLConnection con = (HttpURLConnection) url.openConnection();
        con.setConnectTimeout(8000);
        con.setReadTimeout(10000);
        con.setRequestProperty("Authorization", "Bearer " + token);
        con.setRequestProperty("Accept", "application/json");
        try {
            int code = con.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            try (InputStream in = con.getInputStream()) {
                return new String(readAll(in), StandardCharsets.UTF_8);
            }
        } finally {
            con.disconnect();
        }
    }

    /** "/board-images/x.jpg" → full address on the TV host; full addresses are kept. */
    static String resolve(Context c, String path) {
        if (isBlank(path)) return null;
        if (path.startsWith("http://") || path.startsWith("https://")) return path;
        return baseUrl(c) + (path.startsWith("/") ? path : "/" + path);
    }

    static byte[] download(String address) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(address).openConnection();
        con.setConnectTimeout(8000);
        con.setReadTimeout(20000);
        try {
            int code = con.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            try (InputStream in = con.getInputStream()) {
                return readAll(in);
            }
        } finally {
            con.disconnect();
        }
    }

    /** Decode no bigger than needed for `reqWidth` pixels across; RGB_565 for photos. */
    static Bitmap decode(byte[] bytes, int reqWidth, boolean opaque) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
        int sample = 1;
        while (o.outWidth / (sample * 2) >= reqWidth) sample *= 2;
        BitmapFactory.Options d = new BitmapFactory.Options();
        d.inSampleSize = sample;
        if (opaque) d.inPreferredConfig = Bitmap.Config.RGB_565;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, d);
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
