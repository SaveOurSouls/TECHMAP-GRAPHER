using System.Runtime.InteropServices;

namespace Techmap.Web;

internal static class WindowsProcessErrorMode
{
    internal const uint SuppressedDialogMode =
        FailCriticalErrors |
        NoGeneralProtectionFaultErrorBox |
        NoOpenFileErrorBox;

    internal const uint SuppressedWerFlags = WerFaultReportingNoUi;

    private const uint FailCriticalErrors = 0x0001;
    private const uint NoGeneralProtectionFaultErrorBox = 0x0002;
    private const uint NoOpenFileErrorBox = 0x8000;
    private const uint WerFaultReportingNoUi = 0x0020;

    internal static void Apply()
    {
        Apply(
            OperatingSystem.IsWindows(),
            GetErrorMode,
            SetErrorMode,
            WerSetFlags,
            result => TryReportWerFailure(result));
    }

    internal static void Apply(
        bool isWindows,
        Func<uint> getErrorMode,
        Func<uint, uint> setErrorMode,
        Func<uint, int>? setWerFlags = null,
        Action<int>? reportWerFailure = null)
    {
        if (!isWindows)
        {
            return;
        }

        ArgumentNullException.ThrowIfNull(getErrorMode);
        ArgumentNullException.ThrowIfNull(setErrorMode);
        _ = setErrorMode(getErrorMode() | SuppressedDialogMode);

        if (setWerFlags is null)
        {
            return;
        }

        try
        {
            var result = setWerFlags(SuppressedWerFlags);
            if (result < 0)
            {
                reportWerFailure?.Invoke(result);
            }
        }
        catch (Exception error) when (
            error is EntryPointNotFoundException or
                DllNotFoundException or
                BadImageFormatException or
                PlatformNotSupportedException)
        {
            // SetErrorMode still suppresses legacy critical-error dialogs on Windows versions
            // where the WER process flag API is unavailable.
        }
    }

    private static void TryReportWerFailure(int result)
    {
        try
        {
            Console.Error.WriteLine($"TECHMAP_WER_SUPPRESSION_ERROR=0x{result:X8}");
        }
        catch
        {
            // Dialog suppression must never make process startup fail.
        }
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetErrorMode();

    [DllImport("kernel32.dll")]
    private static extern uint SetErrorMode(uint errorMode);

    [DllImport("kernel32.dll")]
    private static extern int WerSetFlags(uint flags);
}
