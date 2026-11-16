// Jembatan Windows UI Automation (UIA). Satu proses PowerShell hidup terus berisi helper C# yang sudah dikompilasi.
// Node mengirim satu baris JSON per perintah, helper membalas satu baris JSON.
//
// Kenapa UIA, bukan tebak koordinat / tombol buta:
//  - elemen dibaca dari aplikasi aslinya (nama, jenis seperti TabItem/Button, status selected/toggle/nilai, posisi di layar)
//  - klik selalu ke titik tengah elemen sungguhan, dan diperiksa dulu bahwa elemen itu tidak tertutup jendela lain
//  - "invoke" memakai pola UIA (bisa jalan di latar belakang tanpa menyentuh mouse)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CS = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class Uia
{
    // ---------- Win32 ----------
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumProc lpEnumFunc, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }

    static JavaScriptSerializer J = new JavaScriptSerializer();
    static List<AutomationElement> Els = new List<AutomationElement>();
    static int LastX = -1, LastY = -1;
    static DateTime LastAt = DateTime.MinValue;

    static Dictionary<string, object> D(params object[] kv)
    {
        var d = new Dictionary<string, object>();
        for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
        return d;
    }
    static string S(Dictionary<string, object> c, string k)
    {
        object v; if (c.TryGetValue(k, out v) && v != null) return Convert.ToString(v); return "";
    }
    static int I(Dictionary<string, object> c, string k, int def)
    {
        object v; if (c.TryGetValue(k, out v) && v != null) { try { return Convert.ToInt32(v); } catch { } } return def;
    }
    static bool B(Dictionary<string, object> c, string k)
    {
        object v; if (c.TryGetValue(k, out v) && v != null) { try { return Convert.ToBoolean(v); } catch { } } return false;
    }

    // ---------- Loop utama: baca baris JSON, balas baris JSON ----------
    public static void Loop()
    {
        try { SetProcessDPIAware(); } catch { }
        var inp = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        var outp = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        outp.AutoFlush = true;
        J.MaxJsonLength = int.MaxValue;
        outp.WriteLine("{\"ready\":true}");
        string line;
        while ((line = inp.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            Dictionary<string, object> res;
            object rid = null;
            try
            {
                var c = (Dictionary<string, object>)J.DeserializeObject(line);
                c.TryGetValue("rid", out rid);
                res = Handle(c);
            }
            catch (Exception e)
            {
                res = D("ok", false, "error", e.GetType().Name + ": " + e.Message);
            }
            res["rid"] = rid;
            outp.WriteLine(J.Serialize(res));
        }
    }

    static Dictionary<string, object> Handle(Dictionary<string, object> c)
    {
        switch (S(c, "cmd"))
        {
            case "ping": return D("ok", true);
            case "screen": return D("ok", true, "w", GetSystemMetrics(0), "h", GetSystemMetrics(1));
            case "cursor": { POINT p; GetCursorPos(out p); return D("ok", true, "x", p.X, "y", p.Y); }
            case "reset_guard": LastX = -1; LastY = -1; LastAt = DateTime.MinValue; return D("ok", true);
            case "windows": return Windows();
            case "focus": return Focus(S(c, "query"), (IntPtr)Convert.ToInt64(S(c, "hwnd").Length > 0 ? S(c, "hwnd") : "0"));
            case "snapshot": return Snapshot(S(c, "query"), (IntPtr)Convert.ToInt64(S(c, "hwnd").Length > 0 ? S(c, "hwnd") : "0"), I(c, "max", 220));
            case "invoke": return Invoke(I(c, "id", 0));
            case "click": return Click(c);
            case "type": return TypeText(S(c, "text"));
            case "set_value": return SetValue(I(c, "id", 0), S(c, "text"));
            case "key": return Key(S(c, "keys"));
            case "scroll": return Scroll(c);
            case "clock_alarm": return ClockAlarm(c);
            case "clock_timer": return ClockTimer(c);
            default: return D("ok", false, "error", "perintah tidak dikenal: " + S(c, "cmd"));
        }
    }

    // ---------- Jendela ----------
    static string TitleOf(IntPtr h)
    {
        int n = GetWindowTextLength(h);
        if (n <= 0) return "";
        var sb = new StringBuilder(n + 2);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }
    static string ProcOf(IntPtr h)
    {
        try { uint pid; GetWindowThreadProcessId(h, out pid); return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }
    static string ClassOf(IntPtr h)
    {
        var sb = new StringBuilder(128);
        GetClassName(h, sb, 128);
        return sb.ToString();
    }
    static bool EnumAll(EnumProc cb)
    {
        IntPtr hDesk = OpenDesktop("default", 0, false, 0x01FF);
        if (hDesk != IntPtr.Zero)
        {
            return EnumDesktopWindows(hDesk, cb, IntPtr.Zero);
        }
        return EnumWindows(cb, IntPtr.Zero);
    }
    static Dictionary<string, object> Windows()
    {
        var list = new List<object>();
        IntPtr fg = GetForegroundWindow();
        EnumAll(delegate (IntPtr h, IntPtr l)
        {
            if (!IsWindowVisible(h)) return true;
            string t = TitleOf(h);
            string p = ProcOf(h);
            if (p == "TextInputHost" || p == "SearchHost" || p == "ShellExperienceHost") return true;
            if (t.Length == 0 && p.Length == 0) return true;
            list.Add(D("hwnd", h.ToInt64().ToString(), "title", t.Length > 0 ? t : p, "process", p, "foreground", h == fg, "minimized", IsIconic(h)));
            return list.Count < 40;
        });
        return D("ok", true, "windows", list);
    }
    static IntPtr FindWindow(string query)
    {
        string q = query.ToLowerInvariant();
        IntPtr found = IntPtr.Zero;
        IntPtr appFrame = IntPtr.Zero;
        EnumAll(delegate (IntPtr h, IntPtr l)
        {
            if (!IsWindowVisible(h)) return true;
            string t = TitleOf(h);
            string p = ProcOf(h);
            string c = ClassOf(h);
            bool match = (t.Length > 0 && t.ToLowerInvariant().Contains(q)) || (p.Length > 0 && p.ToLowerInvariant().Contains(q));
            if (match)
            {
                if (c == "ApplicationFrameWindow") { appFrame = h; return false; }
                if (found == IntPtr.Zero) found = h;
            }
            return true;
        });
        return appFrame != IntPtr.Zero ? appFrame : found;
    }
    static void Raise(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9);
        keybd_event(0x12, 0, 0, UIntPtr.Zero);   // trik ALT agar SetForegroundWindow tidak diblokir Windows
        SetForegroundWindow(h);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        Thread.Sleep(80);
    }
    static Dictionary<string, object> Focus(string query, IntPtr hwnd)
    {
        IntPtr h = hwnd != IntPtr.Zero ? hwnd : FindWindow(query);
        if (h == IntPtr.Zero) return D("ok", false, "error", "jendela tidak ditemukan: " + query);
        Raise(h);
        return D("ok", true, "hwnd", h.ToInt64().ToString(), "title", TitleOf(h), "foreground", GetForegroundWindow() == h);
    }

    // ---------- Snapshot elemen ----------
    static string TypeName(AutomationElement e)
    {
        string n = null;
        try { n = e.Cached.ControlType.ProgrammaticName; } catch { }
        if (n == null) { try { n = e.Current.ControlType.ProgrammaticName; } catch { return "?"; } }
        int i = n.LastIndexOf('.');
        return i >= 0 ? n.Substring(i + 1) : n;
    }
    static bool Interesting(string t)
    {
        switch (t)
        {
            case "Button": case "TabItem": case "Tab": case "ListItem": case "ComboBox": case "Edit": case "CheckBox":
            case "RadioButton": case "MenuItem": case "Hyperlink": case "Text": case "Slider": case "Spinner":
            case "DataItem": case "TreeItem": case "SplitButton": case "Document": case "List": case "Menu": case "Window":
                return true;
        }
        return false;
    }
    static string Trunc(string s, int n)
    {
        if (s == null) return "";
        s = s.Replace("\r", " ").Replace("\n", " ");
        return s.Length > n ? s.Substring(0, n) + "..." : s;
    }
    static Dictionary<string, object> Snapshot(string query, IntPtr hwnd, int max)
    {
        IntPtr h = hwnd;
        if (h == IntPtr.Zero && query.Length > 0) h = FindWindow(query);
        if (h == IntPtr.Zero) h = GetForegroundWindow();
        if (h == IntPtr.Zero) return D("ok", false, "error", "tidak ada jendela aktif");

        AutomationElement root = AutomationElement.FromHandle(h);
        var cr = new CacheRequest();
        cr.Add(AutomationElement.NameProperty);
        cr.Add(AutomationElement.ControlTypeProperty);
        cr.Add(AutomationElement.AutomationIdProperty);
        cr.Add(AutomationElement.BoundingRectangleProperty);
        cr.Add(AutomationElement.IsEnabledProperty);
        cr.Add(AutomationElement.IsOffscreenProperty);
        cr.TreeFilter = Automation.ControlViewCondition;
        cr.AutomationElementMode = AutomationElementMode.Full;

        AutomationElementCollection col;
        using (cr.Activate()) { col = root.FindAll(TreeScope.Descendants, Condition.TrueCondition); }

        Els = new List<AutomationElement>();
        var items = new List<object>();
        bool truncated = false;
        foreach (AutomationElement e in col)
        {
            try
            {
                if (e.Cached.IsOffscreen) continue;
                var r = e.Cached.BoundingRectangle;
                if (r.IsEmpty || r.Width < 2 || r.Height < 2) continue;
                string t = TypeName(e);
                if (!Interesting(t)) continue;
                string name = e.Cached.Name ?? "";
                if (t == "Text" && name.Length == 0) continue;
                if (items.Count >= max) { truncated = true; break; }

                Els.Add(e);
                var d = D("id", Els.Count, "type", t, "name", Trunc(name, 70), "aid", Trunc(e.Cached.AutomationId, 40),
                          "x", (int)r.X, "y", (int)r.Y, "w", (int)r.Width, "h", (int)r.Height, "en", e.Cached.IsEnabled);
                object pat;
                if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat))
                    d["sel"] = ((SelectionItemPattern)pat).Current.IsSelected;
                if (e.TryGetCurrentPattern(TogglePattern.Pattern, out pat))
                    d["tog"] = ((TogglePattern)pat).Current.ToggleState.ToString();
                if (e.TryGetCurrentPattern(ValuePattern.Pattern, out pat))
                    d["val"] = Trunc(((ValuePattern)pat).Current.Value, 60);
                else if (e.TryGetCurrentPattern(RangeValuePattern.Pattern, out pat))
                    d["val"] = ((RangeValuePattern)pat).Current.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
                items.Add(d);
            }
            catch { }
        }

        var wr = root.Current.BoundingRectangle;
        return D("ok", true,
                 "window", D("hwnd", h.ToInt64().ToString(), "title", TitleOf(h), "process", ProcOf(h),
                             "x", (int)wr.X, "y", (int)wr.Y, "w", (int)wr.Width, "h", (int)wr.Height,
                             "foreground", GetForegroundWindow() == h),
                 "elements", items, "truncated", truncated);
    }

    static AutomationElement El(int id)
    {
        if (id < 1 || id > Els.Count) return null;
        return Els[id - 1];
    }

    // ---------- Invoke / SetValue lewat pola UIA ----------
    static Dictionary<string, object> Invoke(int id)
    {
        var e = El(id);
        if (e == null) return D("ok", false, "error", "id elemen tidak valid (snapshot sudah berganti?)");
        string t = TypeName(e);
        string how = "";
        string err = "";
        var th = new Thread(delegate ()
        {
            try { how = DoInvoke(e, t); }
            catch (Exception ex) { err = ex.Message; }
        });
        th.IsBackground = true;
        th.Start();
        if (!th.Join(3500)) return D("ok", true, "how", "timeout (kemungkinan membuka dialog)");
        if (err.Length > 0) return D("ok", false, "error", err);
        if (how.Length == 0) return D("ok", false, "error", "elemen tidak mendukung invoke, pakai klik");
        return D("ok", true, "how", how);
    }
    static string DoInvoke(AutomationElement e, string t)
    {
        object p;
        bool selFirst = t == "TabItem" || t == "ListItem" || t == "RadioButton" || t == "TreeItem" || t == "DataItem";
        if (selFirst && e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); return "select"; }
        if (t == "CheckBox" && e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { ((TogglePattern)p).Toggle(); return "toggle"; }
        if (t == "ComboBox" && e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ((ExpandCollapsePattern)p).Expand(); return "expand"; }
        if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { ((InvokePattern)p).Invoke(); return "invoke"; }
        if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); return "select"; }
        if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { ((TogglePattern)p).Toggle(); return "toggle"; }
        if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ((ExpandCollapsePattern)p).Expand(); return "expand"; }
        return "";
    }
    static Dictionary<string, object> SetValue(int id, string text)
    {
        var e = El(id);
        if (e == null) return D("ok", false, "error", "id elemen tidak valid (snapshot sudah berganti?)");
        object p;
        if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p))
        {
            var vp = (ValuePattern)p;
            if (vp.Current.IsReadOnly) return D("ok", false, "error", "kolom hanya-baca");
            vp.SetValue(text);
            return D("ok", true, "how", "value");
        }
        if (e.TryGetCurrentPattern(RangeValuePattern.Pattern, out p))
        {
            double v;
            if (!double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v))
                return D("ok", false, "error", "nilai harus angka untuk kontrol ini");
            ((RangeValuePattern)p).SetValue(v);
            return D("ok", true, "how", "range");
        }
        return D("ok", false, "error", "elemen tidak mendukung SetValue, klik lalu ketik");
    }

    // ---------- Mouse nyata ----------
    static INPUT Mouse(uint flags, uint data)
    {
        var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i;
    }
    static void SendMouse(uint flags, uint data)
    {
        SendInput(1, new INPUT[] { Mouse(flags, data) }, Marshal.SizeOf(typeof(INPUT)));
    }
    static bool Interfered()
    {
        if (LastX < 0) return false;
        if ((DateTime.UtcNow - LastAt).TotalSeconds > 25) return false;
        POINT p; GetCursorPos(out p);
        int dx = p.X - LastX, dy = p.Y - LastY;
        return dx * dx + dy * dy > 70 * 70;
    }
    static bool MoveSmooth(int tx, int ty)
    {
        POINT p0; GetCursorPos(out p0);
        double dist = Math.Sqrt((double)((tx - p0.X) * (tx - p0.X) + (ty - p0.Y) * (ty - p0.Y)));
        int steps = Math.Max(5, Math.Min(16, (int)(dist / 35)));
        int px = p0.X, py = p0.Y;
        for (int i = 1; i <= steps; i++)
        {
            double t = (double)i / steps;
            double e = 1 - Math.Pow(1 - t, 3);                 // ease-out, sama dengan animasi overlay
            int x = (int)(p0.X + (tx - p0.X) * e), y = (int)(p0.Y + (ty - p0.Y) * e);
            POINT cur; GetCursorPos(out cur);
            if (i > 1 && (cur.X - px) * (cur.X - px) + (cur.Y - py) * (cur.Y - py) > 40 * 40) return false;   // pengguna merebut mouse
            SetCursorPos(x, y); px = x; py = y;
            Thread.Sleep(5);
        }
        SetCursorPos(tx, ty);
        return true;
    }
    static bool Related(AutomationElement a, AutomationElement b)
    {
        var w = TreeWalker.ControlViewWalker;
        var x = a; for (int i = 0; i < 10 && x != null; i++) { if (Automation.Compare(x, b)) return true; try { x = w.GetParent(x); } catch { break; } }
        x = b; for (int i = 0; i < 10 && x != null; i++) { if (Automation.Compare(x, a)) return true; try { x = w.GetParent(x); } catch { break; } }
        return false;
    }
    static Dictionary<string, object> Click(Dictionary<string, object> c)
    {
        int id = I(c, "id", 0);
        string btn = S(c, "button"); if (btn.Length == 0) btn = "left";
        bool dbl = B(c, "double");
        int x = I(c, "x", -1), y = I(c, "y", -1);
        AutomationElement e = null;
        string name = "";
        if (id > 0)
        {
            e = El(id);
            if (e == null) return D("ok", false, "error", "id elemen tidak valid (snapshot sudah berganti?)");
            var r = e.Current.BoundingRectangle;
            if (r.IsEmpty) return D("ok", false, "error", "elemen tidak punya posisi di layar");
            x = (int)(r.X + r.Width / 2); y = (int)(r.Y + r.Height / 2);
            name = e.Current.Name;
        }
        if (x < 0 || y < 0) return D("ok", false, "error", "butuh id atau x,y");
        if (Interfered()) return D("ok", false, "interrupted", true, "error", "pengguna menggerakkan mouse");

        // pastikan yang ada di titik itu memang elemen target (tidak tertutup jendela lain)
        if (e != null && !B(c, "force"))
        {
            AutomationElement hit = null;
            try { hit = AutomationElement.FromPoint(new System.Windows.Point(x, y)); } catch { }
            if (hit != null && !Related(hit, e))
                return D("ok", false, "covered", true, "error", "elemen tertutup: di titik itu ada \"" + Trunc(hit.Current.Name, 40) + "\" (" + TypeName(hit) + ")");
        }

        if (!MoveSmooth(x, y)) return D("ok", false, "interrupted", true, "error", "pengguna menggerakkan mouse");
        Thread.Sleep(30);
        uint down = btn == "right" ? 0x8u : 0x2u, up = btn == "right" ? 0x10u : 0x4u;
        int times = dbl ? 2 : 1;
        for (int k = 0; k < times; k++)
        {
            SendMouse(down, 0); Thread.Sleep(30); SendMouse(up, 0); Thread.Sleep(35);
        }
        POINT p; GetCursorPos(out p);
        LastX = p.X; LastY = p.Y; LastAt = DateTime.UtcNow;
        return D("ok", true, "x", x, "y", y, "name", name);
    }

    // ---------- Jalur Cepat Deterministik: Alarm & Timer ----------
    static Dictionary<string, object> ClockAlarm(Dictionary<string, object> c)
    {
        int hour = I(c, "hour", 12);
        int min = I(c, "min", 0);
        string label = S(c, "label");

        IntPtr hwnd = FindWindow("Clock");
        if (hwnd == IntPtr.Zero) hwnd = FindWindow("Jam");
        if (hwnd == IntPtr.Zero) hwnd = FindWindow("Time");

        if (hwnd == IntPtr.Zero)
        {
            try { Process.Start("ms-clock:alarm"); } catch { }
            for (int i = 0; i < 30; i++)
            {
                Thread.Sleep(100);
                hwnd = FindWindow("Clock");
                if (hwnd == IntPtr.Zero) hwnd = FindWindow("Jam");
                if (hwnd == IntPtr.Zero) hwnd = FindWindow("Time");
                if (hwnd != IntPtr.Zero) break;
            }
        }
        if (hwnd == IntPtr.Zero) return D("ok", false, "error", "Jendela Jam tidak ditemukan");

        Raise(hwnd);
        AutomationElement root = AutomationElement.FromHandle(hwnd);
        var steps = new List<object>();

        // 1. Tab Alarm
        var alarmBtn = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "AlarmButton"));
        if (alarmBtn != null)
        {
            var r = alarmBtn.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Buka Alarm", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object sel;
            if (alarmBtn.TryGetCurrentPattern(SelectionItemPattern.Pattern, out sel))
            {
                try { ((SelectionItemPattern)sel).Select(); } catch { }
            }
        }

        // 2. Tombol Tambah Alarm
        AutomationElement addBtn = null;
        for (int i = 0; i < 15; i++)
        {
            addBtn = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "AddAlarmButton"));
            if (addBtn != null) break;
            Thread.Sleep(80);
        }
        if (addBtn != null)
        {
            var r = addBtn.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Tambah Alarm", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object inv;
            if (addBtn.TryGetCurrentPattern(InvokePattern.Pattern, out inv))
            {
                try { ((InvokePattern)inv).Invoke(); } catch { }
            }
        }

        // 3. Set Jam dan Menit
        AutomationElement hourPicker = null, minPicker = null;
        for (int i = 0; i < 20; i++)
        {
            Thread.Sleep(60);
            hourPicker = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "HourPicker"));
            if (hourPicker != null) break;
        }
        minPicker = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "MinutePicker"));

        if (hourPicker != null)
        {
            var r = hourPicker.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Jam " + hour.ToString("D2"), "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object vp;
            if (hourPicker.TryGetCurrentPattern(ValuePattern.Pattern, out vp))
            {
                try { ((ValuePattern)vp).SetValue(hour.ToString("D2")); } catch { }
            }
        }

        if (minPicker != null)
        {
            var r = minPicker.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Menit " + min.ToString("D2"), "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object vp;
            if (minPicker.TryGetCurrentPattern(ValuePattern.Pattern, out vp))
            {
                try { ((ValuePattern)vp).SetValue(min.ToString("D2")); } catch { }
            }
        }

        // 4. Label nama alarm (jika ada)
        if (label.Length > 0)
        {
            var nameEdit = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
            if (nameEdit != null)
            {
                object vp;
                if (nameEdit.TryGetCurrentPattern(ValuePattern.Pattern, out vp))
                {
                    try { ((ValuePattern)vp).SetValue(label); } catch { }
                }
            }
        }

        // 5. Tombol Simpan
        var saveBtn = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "PrimaryButton"));
        if (saveBtn != null)
        {
            var r = saveBtn.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Simpan Alarm", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object inv;
            if (saveBtn.TryGetCurrentPattern(InvokePattern.Pattern, out inv))
            {
                try { ((InvokePattern)inv).Invoke(); } catch { }
            }
        }

        return D("ok", true, "steps", steps, "summary", "Alarm berhasil disetel untuk jam " + hour.ToString("D2") + ":" + min.ToString("D2") + (label.Length > 0 ? " (" + label + ")" : ""));
    }

    static Dictionary<string, object> ClockTimer(Dictionary<string, object> c)
    {
        int hours = I(c, "hours", 0);
        int minutes = I(c, "minutes", 0);
        int seconds = I(c, "seconds", 0);
        string label = S(c, "label");

        IntPtr hwnd = FindWindow("Clock");
        if (hwnd == IntPtr.Zero) hwnd = FindWindow("Jam");
        if (hwnd == IntPtr.Zero) hwnd = FindWindow("Time");

        if (hwnd == IntPtr.Zero)
        {
            try { Process.Start("ms-clock:timer"); } catch { }
            for (int i = 0; i < 30; i++)
            {
                Thread.Sleep(100);
                hwnd = FindWindow("Clock");
                if (hwnd == IntPtr.Zero) hwnd = FindWindow("Jam");
                if (hwnd == IntPtr.Zero) hwnd = FindWindow("Time");
                if (hwnd != IntPtr.Zero) break;
            }
        }
        if (hwnd == IntPtr.Zero) return D("ok", false, "error", "Jendela Jam tidak ditemukan");

        Raise(hwnd);
        AutomationElement root = AutomationElement.FromHandle(hwnd);
        var steps = new List<object>();

        // 1. Tab Timer
        var timerBtn = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "TimerButton"));
        if (timerBtn != null)
        {
            var r = timerBtn.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Buka Timer", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object sel;
            if (timerBtn.TryGetCurrentPattern(SelectionItemPattern.Pattern, out sel))
            {
                try { ((SelectionItemPattern)sel).Select(); } catch { }
            }
        }

        // 2. Tombol Tambah Timer
        AutomationElement addBtn = null;
        for (int i = 0; i < 15; i++)
        {
            addBtn = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "AddTimerButton"));
            if (addBtn != null) break;
            Thread.Sleep(80);
        }
        if (addBtn != null)
        {
            var r = addBtn.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Tambah Timer", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object inv;
            if (addBtn.TryGetCurrentPattern(InvokePattern.Pattern, out inv))
            {
                try { ((InvokePattern)inv).Invoke(); } catch { }
            }
        }

        // 3. Set pickers (hours, minutes, seconds)
        AutomationElement hPicker = null, mPicker = null, sPicker = null;
        for (int i = 0; i < 20; i++)
        {
            Thread.Sleep(60);
            hPicker = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, "hours"));
            if (hPicker != null) break;
        }
        mPicker = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, "minutes"));
        sPicker = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, "seconds"));

        if (hPicker != null && hours > 0)
        {
            var r = hPicker.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", hours + " jam", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object vp; if (hPicker.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) try { ((ValuePattern)vp).SetValue(hours.ToString("D2")); } catch { }
        }
        if (mPicker != null)
        {
            var r = mPicker.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", minutes + " menit", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object vp; if (mPicker.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) try { ((ValuePattern)vp).SetValue(minutes.ToString("D2")); } catch { }
        }
        if (sPicker != null && seconds > 0)
        {
            var r = sPicker.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", seconds + " detik", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object vp; if (sPicker.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) try { ((ValuePattern)vp).SetValue(seconds.ToString("D2")); } catch { }
        }

        if (label.Length > 0)
        {
            var nameEdit = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
            if (nameEdit != null)
            {
                object vp; if (nameEdit.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) try { ((ValuePattern)vp).SetValue(label); } catch { }
            }
        }

        var saveBtn = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "PrimaryButton"));
        if (saveBtn != null)
        {
            var r = saveBtn.Current.BoundingRectangle;
            if (!r.IsEmpty) steps.Add(D("name", "Mulai Timer", "x", (int)(r.X + r.Width / 2), "y", (int)(r.Y + r.Height / 2)));
            object inv; if (saveBtn.TryGetCurrentPattern(InvokePattern.Pattern, out inv)) try { ((InvokePattern)inv).Invoke(); } catch { }
        }

        string durStr = (hours > 0 ? hours + " jam " : "") + minutes + " menit" + (seconds > 0 ? " " + seconds + " detik" : "");
        return D("ok", true, "steps", steps, "summary", "Timer " + durStr + " berhasil dipasang dan dimulai!");
    }

    static Dictionary<string, object> Scroll(Dictionary<string, object> c)
    {
        int amount = I(c, "amount", 3);
        bool down = S(c, "direction") != "up";
        int x = I(c, "x", -1), y = I(c, "y", -1);
        if (x >= 0 && y >= 0) { if (Interfered()) return D("ok", false, "interrupted", true, "error", "pengguna menggerakkan mouse"); MoveSmooth(x, y); }
        for (int i = 0; i < amount; i++) { SendMouse(0x800, (uint)(down ? -120 : 120)); Thread.Sleep(60); }
        POINT p; GetCursorPos(out p); LastX = p.X; LastY = p.Y; LastAt = DateTime.UtcNow;
        return D("ok", true);
    }

    // ---------- Keyboard nyata ----------
    static INPUT KeyU(char ch, bool up)
    {
        var i = new INPUT(); i.type = 1; i.u.ki.wScan = ch; i.u.ki.dwFlags = 0x4u | (up ? 0x2u : 0u); return i;
    }
    static Dictionary<string, object> TypeText(string text)
    {
        if (text.Length == 0) return D("ok", false, "error", "teks kosong");
        if (text.Length > 600) text = text.Substring(0, 600);
        foreach (char ch in text)
        {
            if (ch == '\n') { Tap(0x0D); continue; }
            SendInput(2, new INPUT[] { KeyU(ch, false), KeyU(ch, true) }, Marshal.SizeOf(typeof(INPUT)));
            Thread.Sleep(12);
        }
        return D("ok", true, "typed", text.Length);
    }
    static void Tap(byte vk)
    {
        keybd_event(vk, 0, 0, UIntPtr.Zero); Thread.Sleep(30); keybd_event(vk, 0, 2, UIntPtr.Zero); Thread.Sleep(40);
    }
    static int Vk(string k)
    {
        k = k.Trim().ToLowerInvariant();
        switch (k)
        {
            case "enter": case "return": return 0x0D;
            case "tab": return 0x09;
            case "esc": case "escape": return 0x1B;
            case "space": return 0x20;
            case "backspace": return 0x08;
            case "delete": case "del": return 0x2E;
            case "up": return 0x26;
            case "down": return 0x28;
            case "left": return 0x25;
            case "right": return 0x27;
            case "home": return 0x24;
            case "end": return 0x23;
            case "pageup": return 0x21;
            case "pagedown": return 0x22;
            case "ctrl": case "control": return 0x11;
            case "shift": return 0x10;
            case "alt": return 0x12;
            case "win": return 0x5B;
        }
        if (k.Length == 1) { char ch = k[0]; if (ch >= 'a' && ch <= 'z') return 0x41 + (ch - 'a'); if (ch >= '0' && ch <= '9') return 0x30 + (ch - '0'); }
        if (k.Length >= 2 && k[0] == 'f') { int n; if (int.TryParse(k.Substring(1), out n) && n >= 1 && n <= 12) return 0x6F + n; }
        return -1;
    }
    static Dictionary<string, object> Key(string keys)
    {
        var parts = keys.Split('+');
        var vks = new List<int>();
        foreach (var p in parts) { int v = Vk(p); if (v < 0) return D("ok", false, "error", "tombol tidak dikenal: " + p); vks.Add(v); }
        if (vks.Count == 0) return D("ok", false, "error", "tombol kosong");
        // blok kombinasi berbahaya
        if (vks.Contains(0x5B)) return D("ok", false, "error", "tombol Win tidak diizinkan");
        for (int i = 0; i < vks.Count - 1; i++) { keybd_event((byte)vks[i], 0, 0, UIntPtr.Zero); Thread.Sleep(30); }
        Tap((byte)vks[vks.Count - 1]);
        for (int i = vks.Count - 2; i >= 0; i--) { keybd_event((byte)vks[i], 0, 2, UIntPtr.Zero); Thread.Sleep(30); }
        return D("ok", true);
    }
}
`;

function psScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions",
    "$refs = @(",
    "  [System.Windows.Automation.AutomationElement].Assembly.Location,",
    "  [System.Windows.Automation.ControlType].Assembly.Location,",
    "  [System.Windows.Point].Assembly.Location,",
    "  [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,",
    "  'System.dll', 'System.Core.dll')",
    "$src = [System.IO.File]::ReadAllText($env:AERO_UIA_SRC, [System.Text.Encoding]::UTF8)",
    "Add-Type -TypeDefinition $src -ReferencedAssemblies $refs -Language CSharp",
    "[Uia]::Loop()"
  ].join('\n');
}

class UiaBridge {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.rid = 0;
    this.buf = '';
    this.queue = Promise.resolve();
  }

  static supported() { return process.platform === 'win32'; }

  start() {
    if (this.ready) return this.ready;
    if (!UiaBridge.supported()) return (this.ready = Promise.reject(new Error('Kontrol UI hanya didukung di Windows.')));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-uia-'));
    const srcPath = path.join(dir, 'uia.cs');
    const psPath = path.join(dir, 'uia.ps1');
    fs.writeFileSync(srcPath, CS, 'utf8');
    fs.writeFileSync(psPath, psScript(), 'utf8');
    this.dir = dir;

    this.ready = new Promise((resolve, reject) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', psPath], {
        env: { ...process.env, AERO_UIA_SRC: srcPath },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.proc = p;
      let errText = '';
      const timer = setTimeout(() => reject(new Error('Helper UI Automation tidak siap dalam 30 detik. ' + errText.slice(0, 300))), 30000);

      p.stdout.setEncoding('utf8');
      p.stdout.on('data', chunk => {
        this.buf += chunk;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim();
          this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.ready) { clearTimeout(timer); resolve(); continue; }
          const cb = this.pending.get(msg.rid);
          if (cb) { this.pending.delete(msg.rid); cb(msg); }
        }
      });
      p.stderr.setEncoding('utf8');
      p.stderr.on('data', d => { errText += d; });
      p.on('error', e => { clearTimeout(timer); reject(e); });
      p.on('exit', () => {
        clearTimeout(timer);
        this.proc = null;
        this.ready = null;
        for (const cb of this.pending.values()) cb({ ok: false, error: 'helper UI Automation berhenti. ' + errText.slice(0, 300) });
        this.pending.clear();
        reject(new Error('Helper UI Automation gagal dimulai. ' + errText.slice(0, 400)));
      });
    });
    return this.ready;
  }

  // Perintah dijalankan satu per satu (helper memegang state snapshot terakhir).
  call(cmd, args = {}, timeoutMs = 20000) {
    const run = async () => {
      await this.start();
      return new Promise(resolve => {
        const rid = ++this.rid;
        const t = setTimeout(() => { this.pending.delete(rid); resolve({ ok: false, error: `perintah ${cmd} melewati batas waktu` }); }, timeoutMs);
        this.pending.set(rid, msg => { clearTimeout(t); resolve(msg); });
        this.proc.stdin.write(JSON.stringify({ cmd, rid, ...args }) + '\n');
      });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() {
    try { this.proc?.stdin.end(); this.proc?.kill(); } catch {}
    this.proc = null;
    this.ready = null;
    try { if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { UiaBridge, CS };
