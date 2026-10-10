import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "spikes/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // AGENTS.md / PRD §6: ACP may only ever be imported under
    // packages/service/src/agent/acp/.
    files: ["packages/service/src/**/*.ts"],
    ignores: ["packages/service/src/agent/acp/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@agentclientprotocol/*"],
              message:
                "ACP imports are only allowed in packages/service/src/agent/acp/. Use the AgentRunner interface instead.",
            },
          ],
        },
      ],
    },
  },
);
