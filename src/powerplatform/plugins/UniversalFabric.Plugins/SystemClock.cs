using System;

namespace UniversalFabric.Plugins;

/// <summary>
///     Abstraction over the system clock so unit tests can drive deterministic
///     timestamps. Production builds use <see cref="UtcSystemClock" />.
/// </summary>
internal interface ISystemClock
{
    DateTime UtcNow { get; }
}

/// <summary>
///     Default production clock. Returns <see cref="DateTime.UtcNow" /> with
///     <see cref="DateTimeKind.Utc" /> so the plugin always stamps an unambiguous
///     UTC value regardless of the sandbox worker's local time zone.
/// </summary>
internal sealed class UtcSystemClock : ISystemClock
{
    public static readonly ISystemClock Instance = new UtcSystemClock();

    private UtcSystemClock()
    {
    }

    public DateTime UtcNow => DateTime.UtcNow;
}
