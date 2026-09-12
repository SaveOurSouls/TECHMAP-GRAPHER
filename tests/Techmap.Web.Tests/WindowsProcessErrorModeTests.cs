using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class WindowsProcessErrorModeTests
{
    [Fact]
    public void Apply_uses_all_required_dialog_suppression_flags_on_Windows()
    {
        uint? appliedMode = null;

        WindowsProcessErrorMode.Apply(
            isWindows: true,
            getErrorMode: () => 0x0004u,
            mode =>
            {
                appliedMode = mode;
                return 0;
            });

        Assert.Equal(0x8007u, appliedMode);
        Assert.Equal(
            WindowsProcessErrorMode.SuppressedDialogMode,
            appliedMode & WindowsProcessErrorMode.SuppressedDialogMode);
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
}
