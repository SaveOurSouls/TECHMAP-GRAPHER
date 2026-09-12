namespace Techmap.Domain;

public readonly record struct Length
{
    public const long MicrometresPerMillimetre = 1_000;
    public const long MicrometresPerMetre = 1_000_000;

    public Length(long micrometres)
    {
        if (micrometres < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(micrometres),
                "A physical length must not be negative.");
        }

        Micrometres = micrometres;
    }

    public long Micrometres { get; }

    public decimal Millimetres => Micrometres / (decimal)MicrometresPerMillimetre;

    public static Length FromMillimetres(decimal millimetres) =>
        new(ExactUnitConversion.ToWholeUnits(
            millimetres,
            MicrometresPerMillimetre,
            nameof(millimetres)));
}

public readonly record struct LengthCorrection
{
    public LengthCorrection(long micrometres)
    {
        Micrometres = micrometres;
    }

    public long Micrometres { get; }

    public decimal Millimetres => Micrometres / (decimal)Length.MicrometresPerMillimetre;

    public static LengthCorrection FromMillimetres(decimal millimetres) =>
        new(ExactUnitConversion.ToWholeUnits(
            millimetres,
            Length.MicrometresPerMillimetre,
            nameof(millimetres)));
}

public readonly record struct ExactDuration
{
    public const long MicrosecondsPerSecond = 1_000_000;

    public ExactDuration(long microseconds)
    {
        if (microseconds < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(microseconds),
                "A physical duration must not be negative.");
        }

        Microseconds = microseconds;
    }

    public long Microseconds { get; }

    public decimal Seconds => Microseconds / (decimal)MicrosecondsPerSecond;

    public static ExactDuration FromSeconds(decimal seconds) =>
        new(ExactUnitConversion.ToWholeUnits(
            seconds,
            MicrosecondsPerSecond,
            nameof(seconds)));
}

internal static class ExactUnitConversion
{
    public static long ToWholeUnits(decimal value, long unitsPerWhole, string parameterName)
    {
        decimal scaled;
        try
        {
            scaled = checked(value * unitsPerWhole);
        }
        catch (OverflowException exception)
        {
            throw new OverflowException(
                $"'{parameterName}' is outside the supported 64-bit unit range.",
                exception);
        }

        if (scaled != decimal.Truncate(scaled))
        {
            throw new ArgumentException(
                $"'{parameterName}' cannot be represented as a whole number of base units.",
                parameterName);
        }

        try
        {
            return checked((long)scaled);
        }
        catch (OverflowException exception)
        {
            throw new OverflowException(
                $"'{parameterName}' is outside the supported 64-bit unit range.",
                exception);
        }
    }
}
