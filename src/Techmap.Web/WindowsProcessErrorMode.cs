using System.Runtime.InteropServices;

namespace Techmap.Web;

internal static class WindowsProcessErrorMode
{
    internal const uint SuppressedDialogMode =
        FailCriticalErrors |
        NoGeneralProtectionFaultErrorBox |
        NoOpenFileErrorBox;

    private const uint FailCriticalErrors = 0x0001;
    private const uint NoGeneralProtectionFaultErrorBox = 0x0002;
    private const uint NoOpenFileErrorBox = 0x8000;

    internal static void Apply() =>
        Apply(OperatingSystem.IsWindows(), SetErrorMode);

    internal static void Apply(bool isWindows, Func<uint, uint> setErrorMode)
    {
        if (!isWindows)
        {
            return;
        }

        ArgumentNullException.ThrowIfNull(setErrorMode);
        _ = setErrorMode(SuppressedDialogMode);
    }

    [DllImport("kernel32.dll")]
    private static extern uint SetErrorMode(uint errorMode);
}
