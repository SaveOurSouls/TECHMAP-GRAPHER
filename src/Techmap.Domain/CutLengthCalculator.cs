using System.Numerics;

namespace Techmap.Domain;

public sealed record CutLengthInput(
    IReadOnlyList<Length?> SourceDimensions,
    LengthCorrection FirstEndCorrection,
    LengthCorrection SecondEndCorrection,
    Length? RoundingStep = null);

public sealed record CutLengthResult(
    IReadOnlyList<Length?> SourceDimensions,
    LengthCorrection FirstEndCorrection,
    LengthCorrection SecondEndCorrection,
    Length RoundingStep,
    Length? UnroundedTotal,
    Length? CutLength,
    Length? MaterialConsumption)
{
    public bool IsComplete => CutLength is not null;
}

public static class CutLengthCalculator
{
    public static readonly Length DefaultRoundingStep = new(Length.MicrometresPerMillimetre);

    public static CutLengthResult Calculate(CutLengthInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(input.SourceDimensions);

        var roundingStep = input.RoundingStep ?? DefaultRoundingStep;
        if (roundingStep.Micrometres == 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(input),
                "The cut-length rounding step must be greater than zero.");
        }

        IReadOnlyList<Length?> sourceDimensions = Array.AsReadOnly(input.SourceDimensions.ToArray());
        if (sourceDimensions.Count == 0)
        {
            throw new ArgumentException("At least one source dimension is required.", nameof(input));
        }

        if (sourceDimensions.Any(static value => value is null))
        {
            return new CutLengthResult(
                sourceDimensions,
                input.FirstEndCorrection,
                input.SecondEndCorrection,
                roundingStep,
                UnroundedTotal: null,
                CutLength: null,
                MaterialConsumption: null);
        }

        BigInteger totalMicrometres = BigInteger.Zero;
        foreach (var dimension in sourceDimensions)
        {
            totalMicrometres += dimension!.Value.Micrometres;
        }

        totalMicrometres += input.FirstEndCorrection.Micrometres;
        totalMicrometres += input.SecondEndCorrection.Micrometres;

        if (totalMicrometres < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(input),
                "The unrounded cut length must not be negative.");
        }

        if (totalMicrometres > long.MaxValue)
        {
            throw new OverflowException("The unrounded cut length exceeds the supported range.");
        }

        var unroundedTotal = new Length((long)totalMicrometres);
        var roundedMicrometres = BigInteger.DivRem(
            totalMicrometres,
            roundingStep.Micrometres,
            out var remainder) * roundingStep.Micrometres;
        if (!remainder.IsZero)
        {
            roundedMicrometres += roundingStep.Micrometres;
        }

        if (roundedMicrometres > long.MaxValue)
        {
            throw new OverflowException("The rounded cut length exceeds the supported range.");
        }

        var cutLength = new Length((long)roundedMicrometres);

        return new CutLengthResult(
            sourceDimensions,
            input.FirstEndCorrection,
            input.SecondEndCorrection,
            roundingStep,
            unroundedTotal,
            cutLength,
            cutLength);
    }
}
