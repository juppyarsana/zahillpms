// Zahill TV Setup: a small Windows window around provision.ps1 / restore.ps1, for setting up and
// updating the guest TVs from a PC on the hotel network (e.g. over remote desktop).
//
// Built by build.ps1 with the C# compiler that ships with Windows (.NET Framework 4, C# 5 - so no
// string interpolation, no ?. and no => members in this file). Folder it expects next to the .exe:
//   tools\adb\adb.exe (+ dlls)      tools\zahill-tv.apk      tools\apk-version.txt
//   tools\scripts\provision.ps1, restore.ps1, debloat-*.txt, state\      tools\adbkey\ (optional)
//   rooms.csv (room,ip,name)        settings.dat (written here: token encrypted for this Windows user)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace ZahillTvSetup
{
    class Tv
    {
        public string Room = "", Ip = "", Name = "";
        public string Model = "", AppVersion = "", Status = "Not checked", DeviceName = "";
        public string Expected { get { return Name != "" ? Name : "Room " + Room; } }
        // The TV is named after a different room: the address may have moved to another TV.
        public bool OtherRoom { get { return Regex.IsMatch(DeviceName, @"^Room \d+") && !DeviceName.StartsWith("Room " + Room); } }
        public string Serial { get { return Ip.Contains(":") ? Ip : Ip + ":5555"; } }
    }

    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
            Application.Run(new MainForm());
        }
    }

    class MainForm : Form
    {
        readonly string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string Tools(string p) { return Path.Combine(Path.Combine(baseDir, "tools"), p); }
        string AdbDir { get { return Tools("adb"); } }
        string Adb { get { return Path.Combine(AdbDir, "adb.exe"); } }
        string KeyFile { get { return Path.Combine(Tools("adbkey"), "adbkey"); } }
        string Apk { get { return Tools("zahill-tv.apk"); } }
        string Scripts { get { return Tools("scripts"); } }
        string RoomsFile { get { return Path.Combine(baseDir, "rooms.csv"); } }
        string SettingsFile { get { return Path.Combine(baseDir, "settings.dat"); } }
        string apkVersion = "";

        List<Tv> tvs = new List<Tv>();
        ListView list;
        TextBox log, tokenBox, urlBox;
        Button btnCheck, btnSetup, btnUpdate, btnUndo, btnAdd, btnEdit, btnRemove, btnAll;
        Label info;
        volatile bool busy;

        public MainForm()
        {
            Text = "Zahill TV Setup";
            Width = 1000; Height = 720; MinimumSize = new Size(820, 560);
            Font = new Font("Segoe UI", 9.5f);
            StartPosition = FormStartPosition.CenterScreen;

            var top = new TableLayoutPanel { Dock = DockStyle.Top, Height = 74, ColumnCount = 5, Padding = new Padding(8, 8, 8, 0) };
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
            top.Controls.Add(new Label { Text = "Display token", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
            tokenBox = new TextBox { Dock = DockStyle.Fill, UseSystemPasswordChar = true };
            top.Controls.Add(tokenBox, 1, 0);
            top.Controls.Add(new Label { Text = "TV address", AutoSize = true, Anchor = AnchorStyles.Left }, 2, 0);
            urlBox = new TextBox { Dock = DockStyle.Fill, Text = "https://tv.zahill.kdai.cloud" };
            top.Controls.Add(urlBox, 3, 0);
            var save = new Button { Text = "Save", Dock = DockStyle.Fill };
            save.Click += delegate { SaveSettings(); Log("Saved the token and TV address (only this Windows user can read the token)."); };
            top.Controls.Add(save, 4, 0);
            info = new Label { AutoSize = true, ForeColor = Color.DimGray, Anchor = AnchorStyles.Left };
            top.Controls.Add(info, 0, 1);
            top.SetColumnSpan(info, 5);

            list = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, GridLines = true, HideSelection = false };
            list.Columns.Add("Room", 70); list.Columns.Add("Address", 130); list.Columns.Add("Name", 150);
            list.Columns.Add("Model", 150); list.Columns.Add("App", 70); list.Columns.Add("Status", 360);
            list.SelectedIndexChanged += delegate { UpdateButtons(); };
            list.DoubleClick += delegate { EditTv(); };

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 44, Padding = new Padding(6, 6, 6, 0) };
            btnAll = MakeButton("Select all", delegate { foreach (ListViewItem i in list.Items) i.Selected = true; list.Focus(); });
            btnCheck = MakeButton("Check", delegate { Run(Selected(true), CheckTv, "Check"); });
            btnUpdate = MakeButton("Update app", delegate { UpdateSelected(); });
            btnSetup = MakeButton("Set up", delegate { SetupSelected(); });
            btnUndo = MakeButton("Undo setup", delegate { UndoSelected(); });
            btnAdd = MakeButton("Add TV", delegate { AddTv(); });
            btnEdit = MakeButton("Edit", delegate { EditTv(); });
            btnRemove = MakeButton("Remove from list", delegate { RemoveTv(); });
            buttons.Controls.AddRange(new Control[] { btnAll, btnCheck, btnUpdate, btnSetup, btnUndo, btnAdd, btnEdit, btnRemove });

            log = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Font = new Font("Consolas", 9f), BackColor = Color.White };
            var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 330 };
            split.Panel1.Controls.Add(list);
            split.Panel2.Controls.Add(log);

            Controls.Add(split);
            Controls.Add(buttons);
            Controls.Add(top);

            Load += delegate { Startup(); };
            // Stop adb with the window, so the folder can be updated or deleted afterwards.
            FormClosed += delegate { StartServer("kill-server"); };
        }

        Button MakeButton(string text, EventHandler click)
        {
            var b = new Button { Text = text, AutoSize = true, Height = 30, Padding = new Padding(6, 0, 6, 0) };
            b.Click += click;
            return b;
        }

        // ---------- start-up ----------

        void Startup()
        {
            if (!File.Exists(Adb)) { MessageBox.Show("adb.exe is missing from the tools folder. Copy the whole Zahill TV Setup folder again.", Text); Close(); return; }
            try { apkVersion = File.ReadAllText(Tools("apk-version.txt")).Trim(); } catch { }
            info.Text = "TV app in this folder: " + (File.Exists(Apk) ? (apkVersion == "" ? "zahill-tv.apk" : apkVersion) : "MISSING")
                + "   ·   This PC must be on the same network as the TVs (.20, .30 and .1 don't reach each other).";
            LoadSettings();
            LoadRooms();
            UpdateButtons();
            Log("Starting adb...");
            new Thread(delegate ()
            {
                StartServer("kill-server");
                int code = StartServer("start-server");
                Log(File.Exists(Tools("adbkey\\adbkey"))
                    ? "adb ready, with the setup PC's key: TVs that trusted it before won't ask again."
                    : "adb ready. No key from the setup PC is included, so each TV asks once: someone presses OK on the TV.");
                if (code != 0) Log("adb could not start (code " + code + ").");
            }) { IsBackground = true }.Start();
        }

        void LoadRooms()
        {
            tvs.Clear();
            if (File.Exists(RoomsFile))
            {
                foreach (var raw in File.ReadAllLines(RoomsFile).Skip(1))
                {
                    var p = raw.Split(',');
                    if (p.Length < 2 || p[0].Trim() == "" || p[1].Trim() == "") continue;
                    tvs.Add(new Tv { Room = p[0].Trim(), Ip = p[1].Trim(), Name = p.Length > 2 ? p[2].Trim() : "" });
                }
            }
            RefreshList();
        }

        void SaveRooms()
        {
            var sb = new StringBuilder("room,ip,name\r\n");
            foreach (var t in tvs) sb.Append(t.Room).Append(',').Append(t.Ip).Append(',').Append(t.Name.Replace(",", " ")).Append("\r\n");
            File.WriteAllText(RoomsFile, sb.ToString());
        }

        void LoadSettings()
        {
            if (!File.Exists(SettingsFile)) return;
            foreach (var line in File.ReadAllLines(SettingsFile))
            {
                int i = line.IndexOf('=');
                if (i < 0) continue;
                string k = line.Substring(0, i), v = line.Substring(i + 1);
                if (k == "url" && v != "") urlBox.Text = v;
                if (k == "token" && v != "")
                {
                    try { tokenBox.Text = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(v), null, DataProtectionScope.CurrentUser)); }
                    catch { Log("The saved token was saved by another Windows user or PC: type it again and press Save."); }
                }
            }
        }

        void SaveSettings()
        {
            string enc = tokenBox.Text.Trim() == "" ? "" : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(tokenBox.Text.Trim()), null, DataProtectionScope.CurrentUser));
            File.WriteAllText(SettingsFile, "url=" + urlBox.Text.Trim().TrimEnd('/') + "\r\ntoken=" + enc + "\r\n");
        }

        // ---------- list ----------

        void RefreshList()
        {
            if (InvokeRequired) { BeginInvoke(new MethodInvoker(RefreshList)); return; }
            var sel = new HashSet<Tv>(list.SelectedItems.Cast<ListViewItem>().Select(i => (Tv)i.Tag));
            list.BeginUpdate();
            list.Items.Clear();
            foreach (var t in tvs.OrderBy(x => x.Room).ThenBy(x => x.Ip))
            {
                var it = new ListViewItem(new[] { t.Room, t.Ip, t.Name, t.Model, t.AppVersion, t.Status }) { Tag = t };
                if (t.Status.StartsWith("OK") || t.Status.StartsWith("Done") || t.Status.StartsWith("Up to date") || t.Status.StartsWith("Updated")) it.ForeColor = Color.DarkGreen;
                else if (t.Status.StartsWith("Not found") || t.Status.StartsWith("Failed") || t.Status.StartsWith("Waiting")) it.ForeColor = Color.Firebrick;
                else if (t.Status.StartsWith("Working") || t.Status.StartsWith("Checking")) it.ForeColor = Color.RoyalBlue;
                else if (t.Status.StartsWith("Check the address")) it.ForeColor = Color.DarkOrange;
                it.Selected = sel.Contains(t);
                list.Items.Add(it);
            }
            list.EndUpdate();
            UpdateButtons();
        }

        List<Tv> Selected(bool allIfNone)
        {
            var s = list.SelectedItems.Cast<ListViewItem>().Select(i => (Tv)i.Tag).ToList();
            if (s.Count == 0 && allIfNone) s = tvs.ToList();
            return s;
        }

        void UpdateButtons()
        {
            if (InvokeRequired) { BeginInvoke(new MethodInvoker(UpdateButtons)); return; }
            int n = list.SelectedItems.Count;
            btnCheck.Text = n == 0 ? "Check all" : "Check (" + n + ")";
            btnUpdate.Text = n == 0 ? "Update app" : "Update app (" + n + ")";
            btnSetup.Text = n == 0 ? "Set up" : "Set up (" + n + ")";
            foreach (var b in new[] { btnCheck, btnSetup, btnUpdate, btnUndo, btnAdd, btnEdit, btnRemove, btnAll }) b.Enabled = !busy;
            btnCheck.Enabled = !busy && tvs.Count > 0;
            btnSetup.Enabled = btnUpdate.Enabled = !busy && n > 0;
            btnUndo.Enabled = btnEdit.Enabled = !busy && n == 1;
            btnRemove.Enabled = !busy && n > 0;
        }

        void SetStatus(Tv t, string s) { t.Status = s; RefreshList(); }

        void Log(string s)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Log), s); return; }
            log.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + s.Replace("\n", "\r\n          ") + "\r\n");
        }

        // ---------- running things ----------

        class Result { public int Code; public string Output = ""; }

        Result Exec(string file, string args, int timeoutMs, Action<string> onLine = null)
        {
            var psi = new ProcessStartInfo(file, args)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            psi.EnvironmentVariables["PATH"] = AdbDir + ";" + Environment.GetEnvironmentVariable("PATH");
            if (File.Exists(Tools("adbkey\\adbkey"))) psi.EnvironmentVariables["ADB_VENDOR_KEYS"] = Tools("adbkey\\adbkey");
            var sb = new StringBuilder();
            var res = new Result();
            using (var p = new Process { StartInfo = psi })
            {
                var outDone = new ManualResetEvent(false); var errDone = new ManualResetEvent(false);
                Action<string, ManualResetEvent> got = (d, done) =>
                {
                    if (d == null) { done.Set(); return; }
                    lock (sb) sb.AppendLine(d);
                    if (onLine != null && d.Trim() != "") onLine(d);
                };
                p.OutputDataReceived += (s, e) => got(e.Data, outDone);
                p.ErrorDataReceived += (s, e) => got(e.Data, errDone);
                try { p.Start(); }
                catch (Exception ex) { res.Code = -1; res.Output = ex.Message; return res; }
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } res.Code = -2; res.Output = "Timed out"; return res; }
                // Not the plain WaitForExit(): if adb started its server, that process keeps the pipe open.
                outDone.WaitOne(3000); errDone.WaitOne(3000);
                res.Code = p.ExitCode;
            }
            lock (sb) res.Output = sb.ToString().Trim();
            return res;
        }

        // The adb server keeps running in the background, so it is started without reading its output.
        int StartServer(string cmd)
        {
            var psi = new ProcessStartInfo(Adb, cmd) { UseShellExecute = false, CreateNoWindow = true };
            psi.EnvironmentVariables["PATH"] = AdbDir + ";" + Environment.GetEnvironmentVariable("PATH");
            if (File.Exists(KeyFile)) psi.EnvironmentVariables["ADB_VENDOR_KEYS"] = KeyFile;
            try { using (var p = Process.Start(psi)) { if (!p.WaitForExit(30000)) return -2; return p.ExitCode; } }
            catch { return -1; }
        }

        string AdbOut(Tv t, string args, int timeoutMs = 60000) { return Exec(Adb, "-s " + t.Serial + " " + args, timeoutMs).Output; }

        // Runs one action per TV, a few TVs at a time, then puts the buttons back.
        void Run(List<Tv> items, Action<Tv> action, string what, int parallel = 6)
        {
            if (items.Count == 0) return;
            busy = true; UpdateButtons();
            Log(what + ": " + string.Join(", ", items.Select(x => x.Room)));
            new Thread(delegate ()
            {
                using (var gate = new SemaphoreSlim(parallel))
                {
                    var threads = items.Select(t => new Thread(delegate ()
                    {
                        gate.Wait();
                        try { action(t); }
                        catch (Exception ex) { SetStatus(t, "Failed: " + ex.Message); Log("Room " + t.Room + ": " + ex.Message); }
                        finally { gate.Release(); }
                    }) { IsBackground = true }).ToList();
                    threads.ForEach(x => x.Start());
                    threads.ForEach(x => x.Join());
                }
                busy = false; UpdateButtons();
                Log(what + ": finished.");
            }) { IsBackground = true }.Start();
        }

        // Connects and says why not, in words. True = ready for commands.
        bool Connect(Tv t)
        {
            var c = Exec(Adb, "connect " + t.Serial, 20000).Output;
            if (!c.Contains("connected"))
            {
                SetStatus(t, "Not found: TV off, wrong network, or network debugging off");
                return false;
            }
            var st = AdbOut(t, "get-state", 15000);
            if (st.Contains("unauthorized")) { SetStatus(t, "Waiting: press OK (Allow debugging) on the TV, then Check again"); return false; }
            if (!st.Contains("device")) { SetStatus(t, "Not ready: " + st); return false; }
            return true;
        }

        void CheckTv(Tv t)
        {
            SetStatus(t, "Checking...");
            if (!Connect(t)) return;
            t.Model = AdbOut(t, "shell getprop ro.product.model").Trim();
            var pkg = AdbOut(t, "shell dumpsys package com.zahill.tv");
            var m = Regex.Match(pkg, @"versionName=(\S+)");
            t.AppVersion = m.Success ? m.Groups[1].Value : "";
            var name = AdbOut(t, "shell settings get global device_name").Trim();
            t.DeviceName = name;
            if (t.OtherRoom) { SetStatus(t, "Check the address: this TV is named \"" + name + "\", not room " + t.Room + (t.AppVersion == "" ? "" : " · app " + t.AppVersion)); return; }
            string s;
            if (t.AppVersion == "") s = "OK, the Zahill TV app is not installed";
            else if (apkVersion != "" && t.AppVersion != apkVersion) s = "OK, older app (" + t.AppVersion + "): Update app";
            else s = "OK, app up to date";
            if (ListFor(t.Model) == null) s += " · model not known to this setup";
            SetStatus(t, s + " · named \"" + name + "\"");
        }

        // The setup list per model (README.md "Good to know"). null = not known: Set up is refused.
        string[] ListFor(string model)
        {
            if (model == "AQUOS-TVX19A") return new string[0];
            if (model == "SHARP 2K Smart TV") return new[] { "-AnyModel" };
            if (model == "AQUOS-TVX22A") return new[] { "-AnyModel", "-List", Q(Path.Combine(Scripts, "debloat-tvx22a.txt")) };
            if (model == "AQUOS-TVX21B") return new[] { "-AnyModel", "-List", Q(Path.Combine(Scripts, "debloat-tvx21b.txt")) };
            if (model.StartsWith("MiTV")) return new[] { "-AnyModel", "-List", Q(Path.Combine(Scripts, "debloat-mistick.txt")) };
            return null;
        }

        static string Q(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }

        string Token { get { return (string)Invoke(new Func<string>(() => tokenBox.Text.Trim())); } }
        string BaseUrl { get { return (string)Invoke(new Func<string>(() => urlBox.Text.Trim().TrimEnd('/'))); } }

        // Who is in the room now, from the PMS (same call the TV makes). "" = nobody, null = could not ask.
        string GuestIn(Tv t)
        {
            try
            {
                using (var wc = new WebClient())
                {
                    wc.Headers["Authorization"] = "Bearer " + Token;
                    wc.Encoding = Encoding.UTF8;
                    var json = wc.DownloadString(BaseUrl + "/api/display/room/" + Uri.EscapeDataString(t.Room) + "/state");
                    if (Regex.IsMatch(json, "\"booking\"\\s*:\\s*null")) return "";
                    var m = Regex.Match(json, "\"guest_name\"\\s*:\\s*\"([^\"]*)\"");
                    return m.Success ? m.Groups[1].Value : "a guest";
                }
            }
            catch { return null; }
        }

        // Asks once for every selected room that has a guest. Returns the TVs to go ahead with.
        List<Tv> ConfirmGuests(List<Tv> items, string what) { HashSet<string> occupied; return ConfirmGuests(items, what, out occupied); }

        List<Tv> ConfirmGuests(List<Tv> items, string what, out HashSet<string> occupied)
        {
            var withGuest = new List<string>();
            var unknown = new List<string>();
            foreach (var t in items.Select(x => x.Room).Distinct())
            {
                var tv = items.First(x => x.Room == t);
                var g = GuestIn(tv);
                if (g == null) unknown.Add(t); else if (g != "") withGuest.Add(t + " (" + g + ")");
            }
            occupied = new HashSet<string>(withGuest.Select(x => x.Split(' ')[0]).Concat(unknown));
            if (withGuest.Count == 0 && unknown.Count == 0) return items;
            var msg = new StringBuilder();
            if (withGuest.Count > 0) msg.Append("A guest is in: " + string.Join(", ", withGuest) + ".\n\n");
            if (unknown.Count > 0) msg.Append("Could not ask the PMS about: " + string.Join(", ", unknown) + " (check the token and TV address).\n\n");
            msg.Append(what + " those rooms too?\n\nYes = all selected   No = only the empty rooms   Cancel = stop");
            var ans = (DialogResult)Invoke(new Func<DialogResult>(() => MessageBox.Show(this, msg.ToString(), Text, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning)));
            if (ans == DialogResult.Cancel) return new List<Tv>();
            if (ans == DialogResult.Yes) return items;
            var skip = occupied;
            return items.Where(x => !skip.Contains(x.Room)).ToList();
        }

        bool NeedToken()
        {
            if (tokenBox.Text.Trim() != "") return true;
            MessageBox.Show(this, "Type the display token first (PMS: Settings → Property Details → Device Setup), then press Save.", Text);
            return false;
        }

        // ---------- actions ----------

        void UpdateSelected()
        {
            if (!File.Exists(Apk)) { MessageBox.Show(this, "tools\\zahill-tv.apk is missing.", Text); return; }
            if (!NeedToken()) return;
            var items = Selected(false);
            busy = true; UpdateButtons();
            new Thread(delegate ()
            {
                HashSet<string> guests;
                var go = ConfirmGuests(items, "Update the app in", out guests);
                busy = false; UpdateButtons();
                Invoke(new MethodInvoker(() => Run(go, t => UpdateTv(t, !guests.Contains(t.Room)), "Update app", 3)));
            }) { IsBackground = true }.Start();
        }

        void UpdateTv(Tv t, bool pressHome)
        {
            SetStatus(t, "Working: connecting...");
            if (!Connect(t)) return;
            var pkg = AdbOut(t, "shell dumpsys package com.zahill.tv");
            var m = Regex.Match(pkg, @"versionName=(\S+)");
            if (!m.Success) { SetStatus(t, "Failed: the app is not on this TV yet - use Set up"); return; }
            if (apkVersion != "" && m.Groups[1].Value == apkVersion) { t.AppVersion = apkVersion; SetStatus(t, "Up to date (" + apkVersion + ")"); return; }
            SetStatus(t, "Working: installing " + apkVersion + "...");
            var r = Exec(Adb, "-s " + t.Serial + " install -r " + Q(Apk), 300000).Output;
            if (r.Contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE")) { SetStatus(t, "Failed: the app on the TV is signed with another key - use Set up"); return; }
            if (r.Contains("INSUFFICIENT_STORAGE")) { SetStatus(t, "Failed: the TV's storage is full"); return; }
            if (!r.Contains("Success")) { SetStatus(t, "Failed: " + LastLine(r)); return; }
            AdbOut(t, "shell pm grant com.zahill.tv android.permission.WRITE_SECURE_SETTINGS");
            AdbOut(t, "shell appops set com.zahill.tv SYSTEM_ALERT_WINDOW allow");
            if (pressHome) AdbOut(t, "shell input keyevent KEYCODE_HOME");
            t.AppVersion = Regex.Match(AdbOut(t, "shell dumpsys package com.zahill.tv"), @"versionName=(\S+)").Groups[1].Value;
            SetStatus(t, "Updated to " + t.AppVersion + (pressHome ? "" : " (guest in the room: Home not pressed)"));
            Log("Room " + t.Room + " (" + t.Ip + "): updated to " + t.AppVersion);
        }

        void SetupSelected()
        {
            if (!File.Exists(Apk)) { MessageBox.Show(this, "tools\\zahill-tv.apk is missing.", Text); return; }
            if (!NeedToken()) return;
            var items = Selected(false);
            var noModel = items.Where(t => t.Model == "").Select(t => t.Room).ToList();
            if (noModel.Count > 0) { MessageBox.Show(this, "Press Check first for: " + string.Join(", ", noModel) + " (the setup depends on the TV model).", Text); return; }
            var moved = items.Where(t => t.OtherRoom).Select(t => t.Room + " (" + t.Ip + " is named \"" + t.DeviceName + "\")").ToList();
            if (moved.Count > 0)
            {
                MessageBox.Show(this, "Not set up, because the TV at that address says it belongs to another room: " + string.Join(", ", moved)
                    + ".\n\nSet up would give it this room's guest. Find which room the TV is really in, fix the address with Edit, and Check again.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                items = items.Where(t => !t.OtherRoom).ToList();
                if (items.Count == 0) return;
            }
            var unknown = items.Where(t => ListFor(t.Model) == null).Select(t => t.Room + " (" + t.Model + ")").ToList();
            if (unknown.Count > 0) { MessageBox.Show(this, "This setup doesn't know these models yet, so they are not changed: " + string.Join(", ", unknown) + ".\nRun provision.ps1 by hand with the right list.", Text); items = items.Where(t => ListFor(t.Model) != null).ToList(); }
            if (items.Count == 0) return;
            if (MessageBox.Show(this, "Set up " + items.Count + " TV(s): install the app, make it Home and the screensaver, rename the TV, turn off the apps on the setup list.\n\nSafe to repeat. Go ahead?", Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            SaveSettings();
            busy = true; UpdateButtons();
            new Thread(delegate ()
            {
                var go = ConfirmGuests(items, "Set up the TV in");
                busy = false; UpdateButtons();
                Invoke(new MethodInvoker(() => Run(go, SetupTv, "Set up", 2)));
            }) { IsBackground = true }.Start();
        }

        void SetupTv(Tv t)
        {
            SetStatus(t, "Working: connecting...");
            if (!Connect(t)) return;
            var args = new List<string> { "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", Q(Path.Combine(Scripts, "provision.ps1")),
                "-Tv", t.Ip, "-Room", Q(t.Room), "-Token", Q(Token), "-BaseUrl", Q(BaseUrl), "-Apk", Q(Apk) };
            args.AddRange(ListFor(t.Model));
            if (t.Name != "") { args.Add("-DeviceName"); args.Add(Q(t.Name)); }
            var r = Exec("powershell.exe", string.Join(" ", args), 900000, line =>
            {
                Log("[" + t.Room + "] " + line);
                SetStatus(t, "Working: " + Short(line));
            });
            if (r.Code == 0) { SetStatus(t, "Done: Zahill TV is Home, the screensaver is set"); CheckTv(t); }
            else SetStatus(t, "Failed: " + Short(LastLine(r.Output)) + " (see the log below)");
        }

        void UndoSelected()
        {
            var t = Selected(false).FirstOrDefault();
            if (t == null) return;
            var ans = MessageBox.Show(this, "Put room " + t.Room + " (" + t.Ip + ") back to the TV's own Home screen and turn the apps it turned off back on?\n\nAlso remove the Zahill TV app?\nYes = undo and remove the app   No = undo, keep the app   Cancel = stop",
                Text, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
            if (ans == DialogResult.Cancel) return;
            bool uninstall = ans == DialogResult.Yes;
            Run(new List<Tv> { t }, x =>
            {
                SetStatus(x, "Working: connecting...");
                if (!Connect(x)) return;
                var args = "-NoProfile -ExecutionPolicy Bypass -File " + Q(Path.Combine(Scripts, "restore.ps1")) + " -Tv " + x.Ip + (uninstall ? " -Uninstall" : "");
                var r = Exec("powershell.exe", args, 300000, line => Log("[" + x.Room + "] " + line));
                SetStatus(x, r.Code == 0 ? "Done: back to the TV's own Home" : "Failed: " + Short(LastLine(r.Output)));
            }, "Undo setup", 1);
        }

        void AddTv() { var t = new Tv(); if (EditDialog(t, "Add TV")) { tvs.Add(t); SaveRooms(); RefreshList(); } }

        void EditTv()
        {
            var t = Selected(false).FirstOrDefault();
            if (t == null || busy) return;
            if (EditDialog(t, "Edit TV")) { SaveRooms(); RefreshList(); }
        }

        void RemoveTv()
        {
            var s = Selected(false);
            if (s.Count == 0) return;
            if (MessageBox.Show(this, "Remove " + string.Join(", ", s.Select(x => x.Room + " " + x.Ip)) + " from this list? Nothing on the TV changes.", Text, MessageBoxButtons.OKCancel) != DialogResult.OK) return;
            foreach (var t in s) tvs.Remove(t);
            SaveRooms(); RefreshList();
        }

        bool EditDialog(Tv t, string title)
        {
            using (var f = new Form { Text = title, Width = 420, Height = 250, FormBorderStyle = FormBorderStyle.FixedDialog, StartPosition = FormStartPosition.CenterParent, MaximizeBox = false, MinimizeBox = false, Font = Font })
            {
                var g = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(10) };
                g.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
                g.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                var room = new TextBox { Text = t.Room, Dock = DockStyle.Fill };
                var ip = new TextBox { Text = t.Ip, Dock = DockStyle.Fill };
                var name = new TextBox { Text = t.Name, Dock = DockStyle.Fill };
                g.Controls.Add(new Label { Text = "Room ID", AutoSize = true }, 0, 0); g.Controls.Add(room, 1, 0);
                g.Controls.Add(new Label { Text = "TV address", AutoSize = true }, 0, 1); g.Controls.Add(ip, 1, 1);
                g.Controls.Add(new Label { Text = "Cast name", AutoSize = true }, 0, 2); g.Controls.Add(name, 1, 2);
                g.Controls.Add(new Label { Text = "Cast name: empty = \"Room <ID>\". Use it when one room has several TVs.", AutoSize = true, ForeColor = Color.DimGray, MaximumSize = new Size(380, 0) }, 0, 3);
                g.SetColumnSpan(g.GetControlFromPosition(0, 3), 2);
                var ok = new Button { Text = "Save", DialogResult = DialogResult.OK, Width = 90 };
                var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Width = 90 };
                var row = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill };
                row.Controls.Add(cancel); row.Controls.Add(ok);
                g.Controls.Add(row, 0, 4); g.SetColumnSpan(row, 2);
                f.Controls.Add(g); f.AcceptButton = ok; f.CancelButton = cancel;
                while (f.ShowDialog(this) == DialogResult.OK)
                {
                    var r = room.Text.Trim(); var a = ip.Text.Trim();
                    if (r == "" || !Regex.IsMatch(a, @"^\d{1,3}(\.\d{1,3}){3}(:\d+)?$")) { MessageBox.Show(f, "Type the Room ID and the TV's address (like 192.168.20.48)."); continue; }
                    if (tvs.Any(x => x != t && x.Ip == a)) { MessageBox.Show(f, a + " is already in the list."); continue; }
                    if (t.Ip != a || t.Room != r) { t.Model = ""; t.AppVersion = ""; t.DeviceName = ""; t.Status = "Not checked"; }
                    t.Room = r; t.Ip = a; t.Name = name.Text.Trim();
                    return true;
                }
                return false;
            }
        }

        static string LastLine(string s)
        {
            var lines = s.Split('\n').Select(x => x.Trim()).Where(x => x != "" && !x.StartsWith("At ") && !x.StartsWith("+") && !x.StartsWith("CategoryInfo") && !x.StartsWith("FullyQualifiedErrorId")).ToList();
            if (lines.Count == 0) return "no output";
            var err = lines.FirstOrDefault(x => Regex.IsMatch(x, @"\.ps1 : "));
            return Regex.Replace(err ?? lines.Last(), @"^.*\.ps1 : ", "");
        }

        static string Short(string s) { s = s.Trim(); return s.Length > 120 ? s.Substring(0, 117) + "..." : s; }
    }
}
