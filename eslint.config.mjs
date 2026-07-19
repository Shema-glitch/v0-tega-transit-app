import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

export default [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "build/**", "next-env.d.ts"],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },

    plugins: {
      react,
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },

    rules: {
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@next/next/no-img-element": "warn",
    },

    settings: {
      react: {
        version: "detect",
      },
    },
  },

  {
    // One-off maintenance/data-loading scripts, run standalone via `node` —
    // not part of the Next.js bundle, so CommonJS require() is fine here.
    files: ["scripts/**/*.{js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]; 
