module.exports = {
    ignorePatterns: ["lib/**", "node_modules/**"],
    env: {
        browser: true,
        es6: true,
        commonjs: true
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking"
    ],
    parserOptions: {
        project: "tsconfig.eslint.json",
    },
    plugins: [
        "@typescript-eslint",
        "@typescript-eslint/tslint",
    ],
    rules: {
        "@typescript-eslint/array-type": ["error", {default: "array-simple"}],
        '@typescript-eslint/camelcase': 'off',
        '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        '@typescript-eslint/explicit-function-return-type': 'off',
        "@typescript-eslint/explicit-member-accessibility": ["error", {accessibility: "no-public"}],
        "@typescript-eslint/indent": ["error", 2],
        "@typescript-eslint/no-explicit-any": "off",
        '@typescript-eslint/no-namespace': 'off',
        "@typescript-eslint/no-unused-expressions": "error",
        '@typescript-eslint/no-unused-vars': ['warn', { args: 'none' }],
        "@typescript-eslint/no-use-before-define": "off",
        "@typescript-eslint/quotes": ["error", "double", {avoidEscape: true, allowTemplateLiterals: true}],
        "@typescript-eslint/semi": ["error"],
        "@typescript-eslint/unified-signatures": "error",
        "arrow-body-style": ["error", "as-needed"],
        "arrow-parens": ["error", "as-needed"],
        "brace-style": ["error", "1tbs"],
        "comma-dangle": ["error", "always-multiline"],
        "complexity": "off",
        "constructor-super": "error",
        "curly": "error",
        "eol-last": "error",
        "eqeqeq": ["error", "smart"],
        "id-blacklist": ["error", "any", "Number", "number", "String", "string", "Boolean", "boolean", "Undefined", "undefined"],
        "max-len": ["error", {code: 200}],
        "new-parens": "error",
        "no-bitwise": "warn",
        "no-caller": "error",
        "no-console": ["error", { allow: ["warn", "error"] }],
        "no-debugger": "error",
        "no-empty": "error",
        "no-eval": "error",
        "no-multiple-empty-lines": "error",
        "no-new-wrappers": "error",
        "no-shadow": ["error", {hoist: "all"}],
        "no-throw-literal": "error",
        "no-trailing-spaces": "error",
        "no-undef-init": "error",
        "object-shorthand": "error",
        "one-var": ["error", "never"],
        "quote-props": ["error", "consistent-as-needed"],
        "space-before-function-paren": ["error", {anonymous: "never", asyncArrow: "always", named: "never"}],
        "spaced-comment": ["off", "always", {markers: ["/"]}],
        "valid-typeof": "off",
        "@typescript-eslint/tslint/config": [
            "error",
            {
                rules: {
                    "import-spacing": true,
                    "object-literal-sort-keys": true,
                    "whitespace": [
                        true,
                        "check-branch",
                        "check-decl",
                        "check-operator",
                        "check-separator",
                        "check-type",
                        "check-typecast",
                    ],
                },
            },
        ],

        // disabled to avoid conflict with @typescript-eslint rules
        "quotes": "off",
        "semi": "off",

        // candidates for turning on
        "no-fallthrough": "off",
        "no-invalid-this": "off",

        // candidates for turning off
        "no-underscore-dangle": "error",
    },
};
