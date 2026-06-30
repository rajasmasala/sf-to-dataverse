using System;
using Microsoft.Xrm.Sdk;
using Moq;

namespace UniversalFabric.Plugins.Tests.Fakes;

/// <summary>
///     Helpers that build the IServiceProvider handed to a plugin in Execute().
///     Uses Moq so we never have to enumerate every IPluginExecutionContext member
///     — Moq supplies defaults for anything we don't configure, which keeps the
///     tests resilient to SDK surface changes.
/// </summary>
internal static class PluginTestHarness
{
    /// <summary>
    ///     Builds a ServiceProvider for a PreOperation Update on Account whose
    ///     Target is <paramref name="target" />. Stage defaults to 20
    ///     (PreOperation) — pass a different stage to exercise the misregistration
    ///     guard.
    /// </summary>
    public static (Mock<IPluginExecutionContext> context, IServiceProvider provider) Build(
        Entity target,
        int stage = 20)
    {
        var contextMock = new Mock<IPluginExecutionContext>();
        contextMock.SetupGet(c => c.Stage).Returns(stage);
        contextMock.SetupGet(c => c.MessageName).Returns("Update");
        contextMock.SetupGet(c => c.PrimaryEntityName).Returns("account");

        var inputParameters = new ParameterCollection
        {
            { "Target", target }
        };
        contextMock.SetupGet(c => c.InputParameters).Returns(inputParameters);

        var services = new Dictionary<Type, object?>
        {
            [typeof(IPluginExecutionContext)] = contextMock.Object,
            [typeof(IOrganizationService)] = new Mock<IOrganizationService>().Object,
            [typeof(ITracingService)] = new Mock<ITracingService>().Object
        };

        return (contextMock, new FakeServiceProvider(services));
    }

    /// <summary>
    ///     Builds a ServiceProvider whose InputParameters do not contain a Target
    ///     entry. Used to verify the plugin tolerates a Target-less invocation
    ///     rather than throwing NullReferenceException.
    /// </summary>
    public static IServiceProvider BuildWithoutTarget(int stage = 20)
    {
        var contextMock = new Mock<IPluginExecutionContext>();
        contextMock.SetupGet(c => c.Stage).Returns(stage);
        contextMock.SetupGet(c => c.MessageName).Returns("Update");
        contextMock.SetupGet(c => c.PrimaryEntityName).Returns("account");
        contextMock.SetupGet(c => c.InputParameters).Returns(new ParameterCollection());

        var services = new Dictionary<Type, object?>
        {
            [typeof(IPluginExecutionContext)] = contextMock.Object,
            [typeof(IOrganizationService)] = new Mock<IOrganizationService>().Object,
            [typeof(ITracingService)] = new Mock<ITracingService>().Object
        };

        return new FakeServiceProvider(services);
    }
}
