# TECHMAP-GRAPHER third-party notices

This inventory applies to the locked M1-01 dependency set. `pnpm-lock.yaml` and
the committed `packages.lock.json` files are the authoritative version sources.
The release SBOM is generated from those files by `scripts/generate-sbom.ps1`.

## Components distributed in the portable Windows package

| Component | Version | License | Use |
|---|---:|---|---|
| Microsoft .NET Runtime for win-x64 | 10.0.12 | MIT and licenses in `DOTNET-THIRD-PARTY-NOTICES.txt` | Self-contained runtime |
| Microsoft ASP.NET Core Runtime for win-x64 | 10.0.12 | MIT and licenses in `DOTNET-THIRD-PARTY-NOTICES.txt` | Local web server runtime |
| React | 19.3.0 | MIT | Bundled browser UI |
| React DOM | 19.3.0 | MIT | Bundled browser UI |
| Scheduler | 0.28.0 | MIT | React runtime dependency bundled in the UI |

The release must contain the exact `ThirdPartyNotices.txt` delivered with the
.NET distribution used for publish, renamed to
`DOTNET-THIRD-PARTY-NOTICES.txt`. The SBOM generator copies that file and fails
if it is unavailable. This preserves the notices for native and managed
third-party components incorporated into the self-contained runtime.

React, React DOM and Scheduler are copyright Meta Platforms, Inc. and affiliates
and are licensed under the MIT License.

> MIT License
>
> Copyright (c) Meta Platforms, Inc. and affiliates.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Locked npm build and test inventory

These packages are locked inputs to compilation and tests. They are recorded in
the SBOM with build scope; only React, React DOM and Scheduler are distributed as
components of the browser bundle.

| License | Locked packages |
|---|---|
| Apache-2.0 | `@typescript/typescript-* 7.0.2`; `detect-libc 2.1.2`; `expect-type 1.4.0`; `typescript 7.0.2` |
| BSD-3-Clause | `source-map-js 1.2.1` |
| ISC | `picocolors 1.1.1`; `siginfo 2.0.0` |
| MPL-2.0 | `lightningcss 1.33.0`; `lightningcss-* 1.33.0` |
| MIT | `@jridgewell/resolve-uri 3.1.2`; `@jridgewell/sourcemap-codec 1.6.0`; `@jridgewell/trace-mapping 0.3.31`; `@oxc-project/types 0.149.0`; `@rolldown/binding-* 1.2.8`; `@rolldown/pluginutils 1.0.1`; `@types/chai 5.2.3`; `@types/deep-eql 4.0.2`; `@types/estree 1.0.9`; `@types/react 19.2.14`; `@types/react-dom 19.2.3`; `@vitest/mocker 5.0.0`; `@vitest/spy 5.0.0`; `assertion-error 2.0.1`; `chai 6.2.2`; `csstype 3.2.3`; `es-module-lexer 2.3.2`; `estree-walker 3.0.3`; `fdir 6.5.0`; `fsevents 2.3.3`; `magic-string 1.3.1`; `nanoid 3.3.19`; `obug 2.2.1`; `picomatch 4.0.7`; `postcss 8.5.28`; `react 19.3.0`; `react-dom 19.3.0`; `rolldown 1.2.8`; `scheduler 0.28.0`; `stackback 0.0.2`; `std-env 4.2.0`; `tinybench 6.1.4`; `tinyexec 1.3.0`; `tinyglobby 0.2.17`; `vite 8.3.0`; `vitest 5.0.0`; `why-is-node-running 2.3.0` |

The platform wildcards above are presentation-only abbreviations. The generated
SPDX document expands every exact package ID and version present in the lock file,
including optional platform packages.

## Locked NuGet test inventory

The product projects have no external NuGet package dependencies in M1-01. The
following locked packages are used only to compile or run tests and are not copied
to the portable package as product libraries.

| License | Locked packages |
|---|---|
| Apache-2.0 | `xunit.analyzers 2.0.0`; `xunit.v3 4.0.0`; `xunit.v3.assert 4.0.0`; `xunit.v3.common 4.0.0`; `xunit.v3.core.mtp-v2 4.0.0`; `xunit.v3.extensibility.core 4.0.0`; `xunit.v3.mtp-v2 4.0.0`; `xunit.v3.runner.common 4.0.0`; `xunit.v3.runner.inproc.console 4.0.0` |
| MIT | `Microsoft.ApplicationInsights 2.23.0`; `Microsoft.AspNetCore.Mvc.Testing 10.0.12`; `Microsoft.AspNetCore.TestHost 10.0.12`; `Microsoft.Bcl.AsyncInterfaces 6.0.0`; `Microsoft.CodeCoverage 18.10.0`; `Microsoft.Extensions.Configuration 10.0.12`; `Microsoft.Extensions.Configuration.Abstractions 10.0.12`; `Microsoft.Extensions.Configuration.Binder 10.0.12`; `Microsoft.Extensions.Configuration.CommandLine 10.0.12`; `Microsoft.Extensions.Configuration.EnvironmentVariables 10.0.12`; `Microsoft.Extensions.Configuration.FileExtensions 10.0.12`; `Microsoft.Extensions.Configuration.Json 10.0.12`; `Microsoft.Extensions.Configuration.UserSecrets 10.0.12`; `Microsoft.Extensions.DependencyInjection 10.0.12`; `Microsoft.Extensions.DependencyInjection.Abstractions 10.0.12`; `Microsoft.Extensions.DependencyModel 10.0.12`; `Microsoft.Extensions.Diagnostics 10.0.12`; `Microsoft.Extensions.Diagnostics.Abstractions 10.0.12`; `Microsoft.Extensions.FileProviders.Abstractions 10.0.12`; `Microsoft.Extensions.FileProviders.Physical 10.0.12`; `Microsoft.Extensions.FileSystemGlobbing 10.0.12`; `Microsoft.Extensions.Hosting 10.0.12`; `Microsoft.Extensions.Hosting.Abstractions 10.0.12`; `Microsoft.Extensions.Logging 10.0.12`; `Microsoft.Extensions.Logging.Abstractions 10.0.12`; `Microsoft.Extensions.Logging.Configuration 10.0.12`; `Microsoft.Extensions.Logging.Console 10.0.12`; `Microsoft.Extensions.Logging.Debug 10.0.12`; `Microsoft.Extensions.Logging.EventLog 10.0.12`; `Microsoft.Extensions.Logging.EventSource 10.0.12`; `Microsoft.Extensions.Options 10.0.12`; `Microsoft.Extensions.Options.ConfigurationExtensions 10.0.12`; `Microsoft.Extensions.Primitives 10.0.12`; `Microsoft.NET.Test.Sdk 18.10.0`; `Microsoft.Testing.Extensions.Telemetry 2.3.3`; `Microsoft.Testing.Extensions.TrxReport.Abstractions 2.3.3`; `Microsoft.Testing.Platform 2.3.3`; `Microsoft.Testing.Platform.MSBuild 2.3.3`; `Microsoft.TestPlatform.ObjectModel 18.10.0`; `Microsoft.TestPlatform.TestHost 18.10.0`; `Microsoft.Win32.Registry 5.0.0`; `System.Diagnostics.EventLog 10.0.12`; `System.Security.AccessControl 6.0.1` |

## License texts

MIT: <https://spdx.org/licenses/MIT.html>

Apache-2.0: <https://spdx.org/licenses/Apache-2.0.html>

BSD-3-Clause: <https://spdx.org/licenses/BSD-3-Clause.html>

ISC: <https://spdx.org/licenses/ISC.html>

MPL-2.0: <https://spdx.org/licenses/MPL-2.0.html>

The links identify standard license texts; no network access is required to
generate or use the package. Complete .NET distribution notices are shipped as
a local file as described above.
