import globals from "globals";
import pluginJs from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default [
    { ignores: [".node_modules/*", ".homeybuild/*"] },
    {
        files: ["**/*.{js,mjs,cjs}"],
        languageOptions: { globals: globals.node },
    },
    pluginJs.configs.recommended,
    eslintPluginPrettierRecommended,
];
