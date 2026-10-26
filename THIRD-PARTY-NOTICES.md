# Third-party notices (bundled code)

The release tree ships bundles that include code from these npm
packages (the release `dependencies` are only the small runtime set the
service bundle loads externally; everything below is inlined). The
service and adapter rows come from the esbuild metafiles; the web rows
come from the Vite/Rollup build's module list
(`packages/web/dist/web-meta.json`, written by the `unvibe-web-meta`
plugin — not a hand-kept list). Legal comments from the original
sources are also preserved in the bundles.

| Package | Version | License | Bundled in |
|---|---|---|---|
| @agentclientprotocol/claude-agent-acp | 0.89.0 | Apache-2.0 | adapter dist/adapters/claude.js |
| @agentclientprotocol/codex-acp | 2.2.2 | Apache-2.0 | adapter dist/adapters/codex.js |
| @agentclientprotocol/sdk | 1.8.0 | Apache-2.0 | adapter dist/adapters/claude.js, service dist/index.js |
| @anthropic-ai/claude-agent-sdk | 0.3.293 | SEE LICENSE IN README.md | adapter dist/adapters/claude.js |
| @base-ui/react | 1.9.0 | MIT | web dist/assets |
| @base-ui/utils | 0.5.0 | MIT | web dist/assets |
| @floating-ui/core | 1.8.0 | MIT | web dist/assets |
| @floating-ui/dom | 1.8.0 | MIT | web dist/assets |
| @floating-ui/react-dom | 2.1.9 | MIT | web dist/assets |
| @floating-ui/utils | 0.2.12 | MIT | web dist/assets |
| @fontsource/dm-mono | 5.3.0 | OFL-1.1 | web dist/assets |
| @fontsource/fira-code | 5.3.0 | OFL-1.1 | web dist/assets |
| @fontsource/fira-sans | 5.3.0 | OFL-1.1 | web dist/assets |
| @fontsource/fraunces | 5.3.0 | OFL-1.1 | web dist/assets |
| @fontsource/ibm-plex-mono | 5.3.0 | OFL-1.1 | web dist/assets |
| @fontsource/ibm-plex-sans | 5.3.0 | OFL-1.1 | web dist/assets |
| @fontsource/nunito-sans | 5.3.0 | OFL-1.1 | web dist/assets |
| @fontsource/source-serif-4 | 5.3.0 | OFL-1.1 | web dist/assets |
| @shikijs/core | 4.5.0 | MIT | web dist/assets |
| @shikijs/engine-javascript | 4.5.0 | MIT | web dist/assets |
| @shikijs/langs | 4.5.0 | MIT | web dist/assets |
| @shikijs/primitive | 4.5.0 | MIT | web dist/assets |
| @shikijs/types | 4.5.0 | MIT | web dist/assets |
| @shikijs/vscode-textmate | 10.0.2 | MIT | web dist/assets |
| ccount | 2.0.1 | MIT | web dist/assets |
| character-entities-html4 | 2.1.0 | MIT | web dist/assets |
| character-entities-legacy | 3.0.0 | MIT | web dist/assets |
| comma-separated-tokens | 2.0.3 | MIT | web dist/assets |
| cookie | 0.7.2 | MIT | web dist/assets |
| diff | 9.0.0 | BSD-3-Clause | adapter dist/adapters/claude.js |
| entities | 6.0.1 | BSD-2-Clause | service dist/index.js, web dist/assets |
| hast-util-to-html | 9.0.5 | MIT | web dist/assets |
| hast-util-whitespace | 3.0.0 | MIT | web dist/assets |
| html-void-elements | 3.0.0 | MIT | web dist/assets |
| linkify-it | 5.0.2 | MIT | service dist/index.js, web dist/assets |
| markdown-it | 14.3.3 | MIT | service dist/index.js, web dist/assets |
| mdurl | 2.1.0 | MIT | service dist/index.js, web dist/assets |
| oniguruma-parser | 0.12.2 | MIT | web dist/assets |
| oniguruma-to-es | 4.3.6 | MIT | web dist/assets |
| property-information | 7.2.0 | MIT | web dist/assets |
| punycode.js | 2.3.1 | MIT | service dist/index.js, web dist/assets |
| react | 18.3.1 | MIT | web dist/assets |
| react-dom | 18.3.1 | MIT | web dist/assets |
| regex | 6.1.0 | MIT | web dist/assets |
| regex-recursion | 6.0.2 | MIT | web dist/assets |
| regex-utilities | 2.3.0 | MIT | web dist/assets |
| reselect | 5.3.0 | MIT | web dist/assets |
| scheduler | 0.23.2 | MIT | web dist/assets |
| set-cookie-parser | 3.1.3 | MIT | web dist/assets |
| shiki | 4.5.0 | MIT | web dist/assets |
| space-separated-tokens | 2.0.2 | MIT | web dist/assets |
| stringify-entities | 4.0.4 | MIT | web dist/assets |
| uc.micro | 2.1.0 | MIT | service dist/index.js, web dist/assets |
| use-sync-external-store | 1.7.0 | MIT | web dist/assets |
| web-tree-sitter | 0.27.1 | MIT | service dist/index.js |
| zod | 4.6.5 | MIT | adapter dist/adapters/claude.js, service dist/index.js |
| zustand | 5.0.15 | MIT | web dist/assets |
| zwitch | 2.0.4 | MIT | web dist/assets |

## Apache License 2.0

Copyright 2025 JetBrains s.r.o.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

                                Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

## Claude Agent SDK terms

© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.

Claude Agent SDK use is additionally subject to the Legal Agreements at
https://code.claude.com/docs/en/legal-and-compliance.

## Web bundle MIT licences

The following MIT text applies to: @base-ui/react@1.9.0, @base-ui/utils@0.5.0.

MIT License

Copyright (c) 2019 Material-UI SAS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: @floating-ui/core@1.8.0, @floating-ui/dom@1.8.0, @floating-ui/react-dom@2.1.9, @floating-ui/utils@0.2.12.

MIT License

Copyright (c) 2021-present Floating UI contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: @shikijs/core@4.5.0, @shikijs/engine-javascript@4.5.0, @shikijs/langs@4.5.0, @shikijs/primitive@4.5.0, @shikijs/types@4.5.0, shiki@4.5.0.

MIT License

Copyright (c) 2021 Pine Wu
Copyright (c) 2023 Anthony Fu <https://github.com/antfu>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: @shikijs/vscode-textmate@10.0.2.

The MIT License (MIT)

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: ccount@2.0.1, character-entities-html4@2.1.0, character-entities-legacy@3.0.0.

(The MIT License)

Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: comma-separated-tokens@2.0.3, hast-util-whitespace@3.0.0, html-void-elements@3.0.0, space-separated-tokens@2.0.2, zwitch@2.0.4.

(The MIT License)

Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: cookie@0.7.2.

(The MIT License)

Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>
Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: hast-util-to-html@9.0.5.

(The MIT License)

Copyright (c) Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: linkify-it@5.0.2.

Copyright (c) 2015 Vitaly Puzrin.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: markdown-it@14.3.3.

Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: mdurl@2.1.0.

Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

--------------------------------------------------------------------------------

.parse() is based on Joyent's node.js `url` code:

Copyright Joyent, Inc. and other Node contributors. All rights reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.

The following MIT text applies to: oniguruma-parser@0.12.2.

MIT License

Copyright (c) 2025-2026 Steven Levithan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: oniguruma-to-es@4.3.6.

MIT License

Copyright (c) 2024-2026 Steven Levithan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: property-information@7.2.0.

(The MIT License)

Copyright (c) Titus Wormer <mailto:tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: punycode.js@2.3.1, uc.micro@2.1.0.

Copyright Mathias Bynens <https://mathiasbynens.be/>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: react-dom@18.3.1, react@18.3.1, scheduler@0.23.2.

MIT License

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: regex-utilities@2.3.0.

MIT License

Copyright (c) 2024 Steven Levithan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: regex-recursion@6.0.2, regex@6.1.0.

MIT License

Copyright (c) 2025 Steven Levithan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: reselect@5.3.0.

The MIT License (MIT)

Copyright (c) 2015-2018 Reselect Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: set-cookie-parser@3.1.3.

The MIT License (MIT)

Copyright (c) 2015 Nathan Friedly <nathan@nfriedly.com> (http://nfriedly.com/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

The following MIT text applies to: stringify-entities@4.0.4.

(The MIT License)

Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The following MIT text applies to: use-sync-external-store@1.7.0.

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The following MIT text applies to: zustand@5.0.15.

MIT License

Copyright (c) 2019 Paul Henschel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Web fonts (SIL Open Font License 1.1)

- @fontsource/dm-mono@5.3.0: Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) DMMono-LightItalic.ttf: Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) DMMono-Regular.ttf: Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) DMMono-Italic.ttf: Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) DMMono-Medium.ttf: Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) DMMono-MediumItalic.ttf: Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL
- @fontsource/fira-code@5.3.0: Copyright 2014-2020 The Fira Code Project Authors (https://github.com/tonsky/FiraCode) This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL
- @fontsource/fira-sans@5.3.0: Google Inc. This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL
- @fontsource/fraunces@5.3.0: Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) Fraunces-Italic[SOFT,WONK,opsz,wght].ttf: Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL
- @fontsource/ibm-plex-mono@5.3.0: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-ThinItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-ExtraLight.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-ExtraLightItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Light.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-LightItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Regular.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Italic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Medium.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-MediumItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-SemiBold.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-SemiBoldItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Bold.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-BoldItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL
- @fontsource/ibm-plex-sans@5.3.0: Copyright 2019 IBM Corp. All rights reserved. IBMPlexSans-Italic[wdth,wght].ttf: Copyright 2019 IBM Corp. All rights reserved. This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL
- @fontsource/nunito-sans@5.3.0: Copyright 2016 The Nunito Sans Project Authors (https://github.com/Fonthausen/NunitoSans) NunitoSans-Italic[YTLC,opsz,wdth,wght].ttf: Copyright 2016 The Nunito Sans Project Authors (https://github.com/Fonthausen/NunitoSans) This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL
- @fontsource/source-serif-4@5.3.0: Google Inc. This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL

The fonts are compiled into the web build as
`packages/web/dist/assets/*.woff` / `*.woff2` (from the `@fontsource/*`
`files/` directories). This release ships these font files:

- packages/web/dist/assets/dm-mono-latin-400-normal--0xN8mdc.woff
- packages/web/dist/assets/dm-mono-latin-400-normal-4GdczIuU.woff2
- packages/web/dist/assets/dm-mono-latin-500-normal-CN8Miw6E.woff
- packages/web/dist/assets/dm-mono-latin-500-normal-DRMDZjhP.woff2
- packages/web/dist/assets/fira-code-latin-400-normal-C-QZfXAs.woff
- packages/web/dist/assets/fira-code-latin-400-normal-DGosTW8U.woff2
- packages/web/dist/assets/fira-code-latin-500-normal-B6gioGu8.woff2
- packages/web/dist/assets/fira-code-latin-500-normal-aMLC2AMm.woff
- packages/web/dist/assets/fira-code-latin-600-normal-BmSSHshu.woff
- packages/web/dist/assets/fira-code-latin-600-normal-CvYZpPHg.woff2
- packages/web/dist/assets/fira-sans-latin-400-italic-BHZPyyGY.woff2
- packages/web/dist/assets/fira-sans-latin-400-italic-D1LrdPSQ.woff
- packages/web/dist/assets/fira-sans-latin-400-normal-66xCkunx.woff
- packages/web/dist/assets/fira-sans-latin-400-normal-a0AnQzuD.woff2
- packages/web/dist/assets/fira-sans-latin-500-normal-Bkfzcwmr.woff
- packages/web/dist/assets/fira-sans-latin-500-normal-Bvbxc8ch.woff2
- packages/web/dist/assets/fira-sans-latin-600-normal-CXKlxLG9.woff2
- packages/web/dist/assets/fira-sans-latin-600-normal-DtSgd811.woff
- packages/web/dist/assets/fira-sans-latin-700-normal-CRhwpWTq.woff2
- packages/web/dist/assets/fira-sans-latin-700-normal-DgqLm3Fi.woff
- packages/web/dist/assets/fraunces-latin-400-normal-6IfK1voy.woff2
- packages/web/dist/assets/fraunces-latin-400-normal-NUPT2cO8.woff
- packages/web/dist/assets/fraunces-latin-600-normal-BFCDtZfi.woff2
- packages/web/dist/assets/fraunces-latin-600-normal-DL5QCzvS.woff
- packages/web/dist/assets/ibm-plex-mono-latin-400-normal-CvHOgSBP.woff
- packages/web/dist/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2
- packages/web/dist/assets/ibm-plex-mono-latin-500-normal-CB9ihrfo.woff
- packages/web/dist/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2
- packages/web/dist/assets/ibm-plex-sans-latin-400-normal-CDDApCn2.woff2
- packages/web/dist/assets/ibm-plex-sans-latin-400-normal-CYLoc0-x.woff
- packages/web/dist/assets/ibm-plex-sans-latin-500-normal-6ng42L7E.woff2
- packages/web/dist/assets/ibm-plex-sans-latin-500-normal-BgVn5rGT.woff
- packages/web/dist/assets/ibm-plex-sans-latin-600-normal-Cu4Hd6ag.woff
- packages/web/dist/assets/ibm-plex-sans-latin-600-normal-CuJfVYMP.woff2
- packages/web/dist/assets/nunito-sans-latin-400-italic-BF5x-HNR.woff2
- packages/web/dist/assets/nunito-sans-latin-400-italic-CDSdiy1J.woff
- packages/web/dist/assets/nunito-sans-latin-400-normal-AkRraKH2.woff2
- packages/web/dist/assets/nunito-sans-latin-400-normal-DY9yCUyQ.woff
- packages/web/dist/assets/nunito-sans-latin-500-normal-BkymD7ni.woff
- packages/web/dist/assets/nunito-sans-latin-500-normal-DlmaWqTx.woff2
- packages/web/dist/assets/nunito-sans-latin-600-normal-BtVRvDNj.woff2
- packages/web/dist/assets/nunito-sans-latin-600-normal-DLks-Kj1.woff
- packages/web/dist/assets/nunito-sans-latin-700-normal-CICRJDmU.woff2
- packages/web/dist/assets/nunito-sans-latin-700-normal-CLVG92B9.woff
- packages/web/dist/assets/nunito-sans-latin-800-normal-DOf_K5Iw.woff
- packages/web/dist/assets/nunito-sans-latin-800-normal-MgCk9Q3Y.woff2
- packages/web/dist/assets/source-serif-4-latin-400-italic-0j97Jm6B.woff2
- packages/web/dist/assets/source-serif-4-latin-400-italic-Dv9jnFA_.woff
- packages/web/dist/assets/source-serif-4-latin-400-normal-DJ5YJwmz.woff2
- packages/web/dist/assets/source-serif-4-latin-400-normal-Dn3IlU-Z.woff
- packages/web/dist/assets/source-serif-4-latin-600-normal-DMD1h6_f.woff
- packages/web/dist/assets/source-serif-4-latin-600-normal-DouSKlru.woff2

All of the above fonts use the same licence text (SIL Open Font License 1.1):

(as stated in @fontsource/dm-mono/LICENSE)

---
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

## Demo fixture (urllib3/urllib3#5020)

The `fixtures/urllib3-5020/` directory in this release (demo diff, PR
description, recordings, snapshot and pre-rendered diagrams) derives
from urllib3/urllib3 pull request #5020:

- upstream repository: https://github.com/urllib3/urllib3
- pull request: https://github.com/urllib3/urllib3/pull/5020
  ("Unfold obsolete folded response headers")

Fixture files shipped:

- fixtures/urllib3-5020/description.md
- fixtures/urllib3-5020/diff.json
- fixtures/urllib3-5020/manifest.json
- fixtures/urllib3-5020/meta.json
- fixtures/urllib3-5020/snapshot.json
- fixtures/urllib3-5020/recordings/ask-bare-lf.md
- fixtures/urllib3-5020/recordings/ask-cookie.md
- fixtures/urllib3-5020/recordings/ask-cost.md
- fixtures/urllib3-5020/recordings/ask-forwarding.md
- fixtures/urllib3-5020/recordings/ask-header-name.md
- fixtures/urllib3-5020/recordings/ask-identity.md
- fixtures/urllib3-5020/recordings/ask-order.md
- fixtures/urllib3-5020/recordings/ask-regex.md
- fixtures/urllib3-5020/recordings/ask-reject-vs-unfold.md
- fixtures/urllib3-5020/recordings/ask-tests.md
- fixtures/urllib3-5020/recordings/ask-two-spaces.md
- fixtures/urllib3-5020/recordings/concept-header-injection.md
- fixtures/urllib3-5020/recordings/concept-http-headers.md
- fixtures/urllib3-5020/recordings/concept-obs-fold.md
- fixtures/urllib3-5020/recordings/concept-ows-rws.md
- fixtures/urllib3-5020/recordings/concept-regex-performance.md
- fixtures/urllib3-5020/recordings/concept-requests-cookies.md
- fixtures/urllib3-5020/recordings/concept-set-cookie.md
- fixtures/urllib3-5020/recordings/critic.md
- fixtures/urllib3-5020/recordings/depth-central-deep.md
- fixtures/urllib3-5020/recordings/depth-central-simple.md
- fixtures/urllib3-5020/recordings/depth-expansion-deep.md
- fixtures/urllib3-5020/recordings/depth-problem-deep.md
- fixtures/urllib3-5020/recordings/depth-problem-simple.md
- fixtures/urllib3-5020/recordings/diagram-fold.md
- fixtures/urllib3-5020/recordings/diagram-path.md
- fixtures/urllib3-5020/recordings/examples-central.md
- fixtures/urllib3-5020/recordings/examples-problem.md
- fixtures/urllib3-5020/recordings/explain-fast-path.md
- fixtures/urllib3-5020/recordings/explain-header-injection.md
- fixtures/urllib3-5020/recordings/explain-http-headers.md
- fixtures/urllib3-5020/recordings/explain-normalize-long.md
- fixtures/urllib3-5020/recordings/explain-obs-fold.md
- fixtures/urllib3-5020/recordings/explain-ows-rws.md
- fixtures/urllib3-5020/recordings/explain-regex.md
- fixtures/urllib3-5020/recordings/explain-requests.md
- fixtures/urllib3-5020/recordings/explain-rfc-9112.md
- fixtures/urllib3-5020/recordings/explain-set-cookie.md
- fixtures/urllib3-5020/recordings/go-deeper-check.md
- fixtures/urllib3-5020/recordings/go-deeper-design.md
- fixtures/urllib3-5020/recordings/go-deeper-flow.md
- fixtures/urllib3-5020/recordings/go-deeper-regex.md
- fixtures/urllib3-5020/recordings/hunk-conn-0.md
- fixtures/urllib3-5020/recordings/hunk-conn-1.md
- fixtures/urllib3-5020/recordings/hunk-log-0.md
- fixtures/urllib3-5020/recordings/hunk-tconn-0.md
- fixtures/urllib3-5020/recordings/hunk-tconn-1.md
- fixtures/urllib3-5020/recordings/hunk-tconn-2.md
- fixtures/urllib3-5020/recordings/hunk-tsock-0.md
- fixtures/urllib3-5020/recordings/hunk-tsock-1.md
- fixtures/urllib3-5020/recordings/reader.md
- fixtures/urllib3-5020/recordings/second-opinion-central-check.md
- fixtures/urllib3-5020/recordings/second-opinion-f-lf-blind.md
- fixtures/urllib3-5020/recordings/second-opinion-f-perf-blind.md
- fixtures/urllib3-5020/diagrams/5897a4452ede567b.dark.svg
- fixtures/urllib3-5020/diagrams/5897a4452ede567b.light.svg
- fixtures/urllib3-5020/diagrams/d604f9a8e9fb637c.dark.svg
- fixtures/urllib3-5020/diagrams/d604f9a8e9fb637c.light.svg
- fixtures/urllib3-5020/diagrams/f23beae236cc0685.dark.svg
- fixtures/urllib3-5020/diagrams/f23beae236cc0685.light.svg

urllib3 is MIT-licensed. Its licence file (upstream
`LICENSE.txt`, verified October 2026) reads:

MIT License

Copyright (c) 2008-2020 Andrey Petrov and contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Demo diagrams (D2-embedded Source Sans Pro subsets)

The pre-rendered demo SVGs embed WOFF font subsets produced by `d2`
(pinned version 0.9.0 in `mise.toml`; rendered with `--bundle=false`,
so the subsets travel inside the SVG files themselves):

- fixtures/urllib3-5020/diagrams/5897a4452ede567b.dark.svg
- fixtures/urllib3-5020/diagrams/5897a4452ede567b.light.svg
- fixtures/urllib3-5020/diagrams/d604f9a8e9fb637c.dark.svg
- fixtures/urllib3-5020/diagrams/d604f9a8e9fb637c.light.svg
- fixtures/urllib3-5020/diagrams/f23beae236cc0685.dark.svg
- fixtures/urllib3-5020/diagrams/f23beae236cc0685.light.svg

Each SVG's embedded font name table identifies the source font as
Source Sans Pro (Bold and/or Italic subsets):

- Copyright © 2010-2018 Adobe Systems Incorporated
  (http://www.adobe.com/), with Reserved Font Name 'Source'.
- Licence: SIL Open Font License, Version 1.1 — see the full text in
  the Web fonts section above (same licence, same obligations:
  keep this copyright notice with the licence text).

`d2` itself is not shipped in this release (it runs on the
developer's machine to re-render diagrams); only these SVG outputs
and their embedded subsets ship here.

## Tree-sitter grammars (enclosing-unit expansion)

The `packages/service/dist/grammars/` directory in this release holds
plain `.wasm` files copied at build time from two MIT-licensed npm
packages (dev-only sources; the release has no new dependency):

- web-tree-sitter@0.27.1: the WebAssembly
  runtime (`web-tree-sitter.wasm`), loaded by the service to find the
  enclosing function or class of a hunk:

The MIT License (MIT)

Copyright (c) 2018 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

- @vscode/tree-sitter-wasm@0.3.1:
  the prebuilt grammar files:

- packages/service/dist/grammars/tree-sitter-go.wasm
- packages/service/dist/grammars/tree-sitter-java.wasm
- packages/service/dist/grammars/tree-sitter-javascript.wasm
- packages/service/dist/grammars/tree-sitter-python.wasm
- packages/service/dist/grammars/tree-sitter-ruby.wasm
- packages/service/dist/grammars/tree-sitter-rust.wasm
- packages/service/dist/grammars/tree-sitter-tsx.wasm
- packages/service/dist/grammars/tree-sitter-typescript.wasm
- packages/service/dist/grammars/web-tree-sitter.wasm

MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE

## Unvibe's own licence

Unvibe itself is MIT-licensed. Its licence ships separately as `LICENSE`
at the root of this release tree and is not repeated here.
