using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class WeldingLauncher
{
    private const string Title = "용접 시뮬레이터";

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var reopen = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\WeldingXR_Open_v1"))
        using (var mutex = new Mutex(false, @"Local\WeldingXR_Launcher_v1"))
        {
            bool owned;
            try { owned = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { owned = true; }
            if (!owned) { reopen.Set(); return; }
            try { Run(reopen); }
            catch (Exception error)
            {
                MessageBox.Show("시뮬레이터를 실행하지 못했습니다.\n\n" + error.Message,
                    Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static string FindNode(string root)
    {
        string[] locations = {
            Path.Combine(root, "runtime", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
        };
        foreach (string file in locations) if (File.Exists(file)) return file;
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try
            {
                if (String.IsNullOrWhiteSpace(directory)) continue;
                string file = Path.Combine(directory.Trim('"'), "node.exe");
                if (File.Exists(file)) return file;
            }
            catch (ArgumentException) { }
        }
        throw new FileNotFoundException("Node.js를 찾을 수 없습니다. Node.js를 설치한 뒤 다시 실행해 주세요.");
    }

    private static void OpenBrowser(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception error)
        {
            MessageBox.Show("브라우저에서 다음 주소를 열어 주세요.\n" + url + "\n\n" + error.Message, Title);
        }
    }

    private static void Run(EventWaitHandle reopen)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "tools", "desktop-server.mjs");
        if (!File.Exists(script) || !File.Exists(Path.Combine(root, "index.html")))
            throw new FileNotFoundException("EXE를 welding-xr-demo 폴더 안에 두세요. 바탕화면에서는 바로가기를 사용해 주세요.");
        var start = new ProcessStartInfo(FindNode(root), "\"" + script + "\"") {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        using (var server = new Process { StartInfo = start })
        {
            string serverError = "";
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                if (e.Data != null) serverError = e.Data;
            };
            server.Start();
            server.BeginErrorReadLine();
            try
            {
                var ready = Task.Factory.StartNew(() => server.StandardOutput.ReadLine());
                if (!ready.Wait(15000)) throw new TimeoutException("서버 시작 시간이 초과되었습니다.");
                string line = ready.Result;
                if (line == null || !line.StartsWith("WELDING_READY "))
                    throw new InvalidOperationException("서버를 시작하지 못했습니다. " + serverError);
                string url = line.Substring("WELDING_READY ".Length);
                Uri address;
                if (!Uri.TryCreate(url, UriKind.Absolute, out address) || address.Scheme != "http" || address.Host != "127.0.0.1")
                    throw new InvalidOperationException("서버 주소가 올바르지 않습니다.");

                using (var menu = new ContextMenuStrip())
                using (var tray = new NotifyIcon())
                using (var timer = new System.Windows.Forms.Timer())
                using (var app = new ApplicationContext())
                using (var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath))
                {
                    menu.Items.Add("시뮬레이터 열기", null, delegate { OpenBrowser(url); });
                    menu.Items.Add("종료", null, delegate { app.ExitThread(); });
                    tray.Icon = icon;
                    tray.Text = Title;
                    tray.ContextMenuStrip = menu;
                    tray.DoubleClick += delegate { OpenBrowser(url); };
                    tray.Visible = true;
                    timer.Interval = 400;
                    timer.Tick += delegate {
                        if (server.HasExited) {
                            timer.Stop();
                            MessageBox.Show("서버가 종료되었습니다. 아이콘을 눌러 다시 실행해 주세요.\n" + serverError, Title);
                            app.ExitThread();
                        } else if (reopen.WaitOne(0)) OpenBrowser(url);
                    };
                    timer.Start();
                    OpenBrowser(url);
                    Application.Run(app);
                    tray.Visible = false;
                }
            }
            finally
            {
                if (!server.HasExited) {
                    server.StandardInput.Close();
                    if (!server.WaitForExit(3000)) server.Kill();
                }
            }
        }
    }
}
