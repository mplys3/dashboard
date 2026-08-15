using System.Runtime.InteropServices;

namespace HaDashboardWidget;

public static class Program
{
    [MTAThread]
    public static void Main(string[] args)
    {
        if (args.Length == 0 || args[0] != "-RegisterProcessAsComServer")
        {
            return;
        }

        WinRT.ComWrappersSupport.InitializeComWrappers();
        using var registration = RegistrationManager<DashboardWidgetProvider>.RegisterProvider();
        registration.DisposedEvent.WaitOne();
    }
}
