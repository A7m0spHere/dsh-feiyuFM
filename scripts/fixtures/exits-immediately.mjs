// Fixture used by test/plugin-bundle.test.mjs: a core entry that exits at once,
// proving `apply` reports a dead core instead of throwing into the Harness.
// It lives outside test/ because Node treats every file under test/ as a test.
process.stderr.write('fishfm-core fixture: exiting\n');
process.exit(9);