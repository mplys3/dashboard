using Microsoft.Windows.Widgets.Providers;
using System.Runtime.InteropServices;
using WinRT;

namespace HaDashboardWidget;

internal sealed class RegistrationManager<TProvider> : IDisposable
    where TProvider : IWidgetProvider, new()
{
    private readonly uint _cookie;
    private bool _disposed;

    private RegistrationManager(uint cookie)
    {
        _cookie = cookie;
    }

    public ManualResetEvent DisposedEvent { get; } = new(false);

    public static RegistrationManager<TProvider> RegisterProvider()
    {
        var factory = new WidgetProviderFactory<TProvider>();
        var result = NativeMethods.CoRegisterClassObject(
            typeof(TProvider).GUID,
            factory,
            0x4, // CLSCTX_LOCAL_SERVER
            0x1, // REGCLS_MULTIPLEUSE
            out var cookie);

        Marshal.ThrowExceptionForHR(result);
        return new RegistrationManager<TProvider>(cookie);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        NativeMethods.CoRevokeClassObject(_cookie);
        _disposed = true;
        DisposedEvent.Set();
        DisposedEvent.Dispose();
    }

}

internal static class NativeMethods
{
    [DllImport("ole32.dll")]
    internal static extern int CoRegisterClassObject(
        [MarshalAs(UnmanagedType.LPStruct)] Guid clsid,
        [MarshalAs(UnmanagedType.IUnknown)] object classFactory,
        uint context,
        uint flags,
        out uint cookie);

    [DllImport("ole32.dll")]
    internal static extern int CoRevokeClassObject(uint cookie);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("00000001-0000-0000-C000-000000000046")]
internal interface IClassFactory
{
    [PreserveSig]
    int CreateInstance(IntPtr outer, ref Guid interfaceId, out IntPtr instance);

    [PreserveSig]
    int LockServer(bool lockServer);
}

internal sealed class WidgetProviderFactory<TProvider> : IClassFactory
    where TProvider : IWidgetProvider, new()
{
    private static readonly Guid IUnknownId = Guid.Parse("00000000-0000-0000-C000-000000000046");

    public int CreateInstance(IntPtr outer, ref Guid interfaceId, out IntPtr instance)
    {
        instance = IntPtr.Zero;

        if (outer != IntPtr.Zero)
        {
            return unchecked((int)0x80040110); // CLASS_E_NOAGGREGATION
        }

        if (interfaceId != typeof(TProvider).GUID && interfaceId != IUnknownId)
        {
            return unchecked((int)0x80004002); // E_NOINTERFACE
        }

        instance = MarshalInspectable<IWidgetProvider>.FromManaged(new TProvider());
        return 0;
    }

    public int LockServer(bool lockServer) => 0;
}
