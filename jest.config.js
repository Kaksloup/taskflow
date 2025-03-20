module.exports = {
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    collectCoverage: true,
    coverageDirectory: ".coverage",
    coverageReporters: ["json", "lcov", "text", "clover", "cobertura"],
    testTimeout: 30000,
    coveragePathIgnorePatterns: ["/node_modules/", "/.coverage/"],
    reporters: ["default", ["jest-junit", { outputDirectory: ".coverage", outputName: "junit.xml" }]]
};
