export interface FormatterSettings {
    dialect: "mysql" | "mariadb";
    indentSize: number;
    useTabs: boolean;
    keywordCase: "upper" | "lower" | "preserve";
    functionCase: "upper" | "lower" | "preserve";
    identifierCase: "preserve" | "upper" | "lower";
    explicitColumnAliases: boolean;
    commaPosition: "trailing" | "leading";
    clauseContentOnNewLine: boolean;
    oneColumnPerLine: boolean;
    joinTableOnNewLine: boolean;
    breakBeforeLogicalOperator: boolean;
    maxLineLength: number;
    preserveComments: boolean;
    preserveBlankLines: boolean;
    trailingSemicolon: "preserve" | "always" | "never";
}

export const defaults: Readonly<FormatterSettings> = {
    dialect: "mysql",
    indentSize: 4,
    useTabs: false,
    keywordCase: "upper",
    functionCase: "upper",
    identifierCase: "preserve",
    explicitColumnAliases: true,
    commaPosition: "trailing",
    clauseContentOnNewLine: true,
    oneColumnPerLine: true,
    joinTableOnNewLine: true,
    breakBeforeLogicalOperator: true,
    maxLineLength: 120,
    preserveComments: true,
    preserveBlankLines: true,
    trailingSemicolon: "preserve",
};
