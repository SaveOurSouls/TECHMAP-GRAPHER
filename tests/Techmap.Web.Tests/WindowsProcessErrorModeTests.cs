using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class WindowsProcessErrorModeTests
{
    [Fact]
    public void Apply_uses_all_required_dialog_suppression_flags_on_Windows()
    {
        uint? appliedMode = null;
        uint? appliedWerFlags = null;

        WindowsProcessErrorMode.Apply(
            isWindows: true,
            getErrorMode: () => 0x0004u,
            mode =>
            {
                appliedMode = mode;
                return 0;
            },
            flags =>
            {
                appliedWerFlags = flags;
                return 0;
            });

        Assert.Equal(0x8007u, appliedMode);
        Assert.Equal(
            WindowsProcessErrorMode.SuppressedDialogMode,
            appliedMode & WindowsProcessErrorMode.SuppressedDialogMode);
        Assert.Equal(WindowsProcessErrorMode.SuppressedWerFlags, appliedWerFlags);
    }

    [Fact]
    public void Apply_is_a_no_op_outside_Windows()
    {
        var nativeCallCount = 0;

        WindowsProcessErrorMode.Apply(
            isWindows: false,
            getErrorMode: () => throw new InvalidOperationException("Native API must not be called."),
            mode =>
            {
                nativeCallCount++;
                return mode;
            });

        Assert.Equal(0, nativeCallCount);
    }

    [Theory]
    [InlineData(typeof(EntryPointNotFoundException))]
    [InlineData(typeof(DllNotFoundException))]
    [InlineData(typeof(BadImageFormatException))]
    [InlineData(typeof(PlatformNotSupportedException))]
    public void Apply_keeps_legacy_suppression_when_Wer_API_is_unavailable(Type exceptionType)
    {
        uint? appliedMode = null;

        WindowsProcessErrorMode.Apply(
            isWindows: true,
            getErrorMode: () => 0,
            mode =>
            {
                appliedMode = mode;
                return 0;
            },
            _ => throw (Exception)Activator.CreateInstance(exceptionType)!);

        Assert.Equal(WindowsProcessErrorMode.SuppressedDialogMode, appliedMode);
    }

    [Fact]
    public void Apply_reports_a_failed_Wer_HRESULT_without_aborting_startup()
    {
        int? reported = null;

        WindowsProcessErrorMode.Apply(
            isWindows: true,
            getErrorMode: () => 0,
            setErrorMode: mode => mode,
            setWerFlags: _ => unchecked((int)0x80004005),
            reportWerFailure: result => reported = result);

        Assert.Equal(unchecked((int)0x80004005), reported);
    }
}
