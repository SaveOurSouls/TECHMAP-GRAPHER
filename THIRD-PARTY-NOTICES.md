# TECHMAP-GRAPHER third-party notices

This inventory applies to the locked portable Web dependency set. `pnpm-lock.yaml` and
the committed `packages.lock.json` files are the authoritative version sources.
The release SBOM is generated from those files by `scripts/generate-sbom.ps1`.

## Components distributed in the portable Windows package

| Component | Version | License | Use |
|---|---:|---|---|
| Microsoft .NET Runtime for win-x64 | 10.0.12 | MIT and licenses in `DOTNET-THIRD-PARTY-NOTICES.txt` | Self-contained runtime |
| Microsoft ASP.NET Core Runtime for win-x64 | 10.0.12 | MIT and licenses in `DOTNET-THIRD-PARTY-NOTICES.txt` | Local web server runtime |
| Microsoft.Data.Sqlite and Microsoft.Data.Sqlite.Core | 10.0.12 | MIT | SQLite ADO.NET provider |
| Microsoft.EntityFrameworkCore.Sqlite and EF Core dependencies | 10.0.12 | MIT | Persistence mapping foundation for product data |
| SQLite | 3.53.3 | Public Domain | Bundled native database engine |
| SQLitePCLRaw.bundle_e_sqlite3, core, lib.e_sqlite3 and provider.e_sqlite3 | 2.1.12 | Apache-2.0 | Native packaging and .NET interop |
| DocumentFormat.OpenXml and DocumentFormat.OpenXml.Framework | 3.3.0 | MIT | Safe read-only parsing of XLSX workbooks |
| System.IO.Packaging | 8.0.1 | MIT | Open Packaging Convention support for XLSX |
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

## Locked NuGet inventory

NuGet lock files contain both product and test dependencies. The generated SPDX
document assigns distributed or test scope from the source of each lock entry and
expands every exact package ID and version. The reviewed license families are:

| License | Locked packages |
|---|---|
| Apache-2.0 | `SQLitePCLRaw.* 2.1.12`; `xunit.analyzers 2.0.0`; `xunit.v3* 4.0.0` |
| MIT | `DocumentFormat.OpenXml* 3.3.0`; `Microsoft.Data.Sqlite* 10.0.12`; `Microsoft.EntityFrameworkCore* 10.0.12`; `System.IO.Packaging 8.0.1`; other locked `Microsoft.*` and `System.*` packages; exact IDs and versions are in the SPDX document |

## License texts

HEIC import uses the unmodified libheif JavaScript decoder distributed with
`heic-to 1.5.2` (LGPL-3.0-or-later), based on libheif 1.22.2.
Library notices, JavaScript source and build description are included under
`ThirdParty/heic-to`. Upstream source: https://github.com/hoppergee/heic-to
and https://github.com/strukturag/libheif/tree/v1.22.2.
The decoder is a separate worker asset and can be replaced and rebuilt using
the application source. The importer does not upload images to any service.

MIT: <https://spdx.org/licenses/MIT.html>

Apache-2.0: <https://spdx.org/licenses/Apache-2.0.html>

SQLite public-domain dedication: <https://www.sqlite.org/copyright.html>

BSD-3-Clause: <https://spdx.org/licenses/BSD-3-Clause.html>

ISC: <https://spdx.org/licenses/ISC.html>

MPL-2.0: <https://spdx.org/licenses/MPL-2.0.html>

The links identify standard license texts; no network access is required to
generate or use the package. Complete .NET distribution notices are shipped as
a local file as described above.

## Covering textures (ambientCG)

Rubber002, Fabric061 and Metal049A color maps © ambientCG contributors,
dedicated to the public domain under CC0 1.0 Universal:
https://creativecommons.org/publicdomain/zero/1.0/ .
Sources and modifications: `wwwroot/textures/coverings/SOURCES.md`.
