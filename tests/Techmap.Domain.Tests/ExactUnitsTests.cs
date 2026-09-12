using Techmap.Domain;
using Xunit;

namespace Techmap.Domain.Tests;

public sealed class ExactUnitsTests
{
    [Fact]
    public void Decimal_units_are_converted_exactly_without_binary_float()
    {
        var length = Length.FromMillimetres(12.345m);
        var correction = LengthCorrection.FromMillimetres(-2.125m);
        var duration = ExactDuration.FromSeconds(5.100001m);

        Assert.Equal(12_345, length.Micrometres);
        Assert.Equal(12.345m, length.Millimetres);
        Assert.Equal(-2_125, correction.Micrometres);
        Assert.Equal(-2.125m, correction.Millimetres);
        Assert.Equal(5_100_001, duration.Microseconds);
        Assert.Equal(5.100001m, duration.Seconds);
    }

    [Fact]
    public void Values_finer_than_base_units_are_rejected_instead_of_silently_rounded()
    {
        Assert.Throws<ArgumentException>(() => Length.FromMillimetres(0.0001m));
        Assert.Throws<ArgumentException>(() => LengthCorrection.FromMillimetres(-0.0001m));
        Assert.Throws<ArgumentException>(() => ExactDuration.FromSeconds(0.0000001m));
    }

    [Fact]
    public void Negative_physical_values_are_rejected_but_zero_is_valid()
    {
        Assert.Equal(0, new Length(0).Micrometres);
        Assert.Equal(0, new ExactDuration(0).Microseconds);
        Assert.Throws<ArgumentOutOfRangeException>(() => new Length(-1));
        Assert.Throws<ArgumentOutOfRangeException>(() => new ExactDuration(-1));
    }

    [Fact]
    public void Unknown_is_distinct_from_physical_zero()
    {
        Length? unknownLength = null;
        ExactDuration? unknownDuration = null;

        Assert.Null(unknownLength);
        Assert.Null(unknownDuration);
        Assert.NotNull((Length?)new Length(0));
        Assert.NotNull((ExactDuration?)new ExactDuration(0));
    }

    [Fact]
    public void Whole_unit_conversion_supports_long_boundaries_and_rejects_overflow()
    {
        Assert.Equal(long.MaxValue,
            Length.FromMillimetres(long.MaxValue / 1_000m).Micrometres);
        Assert.Equal(long.MinValue,
            LengthCorrection.FromMillimetres(long.MinValue / 1_000m).Micrometres);
        Assert.Equal(long.MaxValue,
            ExactDuration.FromSeconds(long.MaxValue / 1_000_000m).Microseconds);

        Assert.Throws<OverflowException>(() =>
            Length.FromMillimetres((long.MaxValue + 1m) / 1_000m));
        Assert.Throws<OverflowException>(() =>
            LengthCorrection.FromMillimetres((long.MinValue - 1m) / 1_000m));
        Assert.Throws<OverflowException>(() =>
            ExactDuration.FromSeconds((long.MaxValue + 1m) / 1_000_000m));
        Assert.Throws<OverflowException>(() => Length.FromMillimetres(decimal.MaxValue));
    }
}
