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
            mode =>
            {
                appliedMode = mode;
                return 0;
            });

        Assert.Equal(0x8003u, appliedMode);
        Assert.Equal(WindowsProcessErrorMode.SuppressedDialogMode, appliedMode);
    }

    [Fact]
    public void Apply_is_a_no_op_outside_Windows()
    {
        var nativeCallCount = 0;

        WindowsProcessErrorMode.Apply(
            isWindows: false,
            mode =>
            {
                nativeCallCount++;
                return mode;
            });

        Assert.Equal(0, nativeCallCount);
    }
}
