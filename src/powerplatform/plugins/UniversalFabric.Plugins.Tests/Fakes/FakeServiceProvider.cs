using System;
using System.Collections.Generic;

namespace UniversalFabric.Plugins.Tests.Fakes;

/// <summary>
///     Minimal <see cref="IServiceProvider" /> backed by a dictionary — enough
///     for the plugin's <see cref="System.IServiceProvider.GetService" /> lookups.
/// </summary>
internal sealed class FakeServiceProvider : IServiceProvider
{
    private readonly IReadOnlyDictionary<Type, object?> _services;

    public FakeServiceProvider(IReadOnlyDictionary<Type, object?> services)
    {
        _services = services ?? throw new ArgumentNullException(nameof(services));
    }

    public object? GetService(Type serviceType)
    {
        return _services.TryGetValue(serviceType, out var svc) ? svc : null;
    }
}
