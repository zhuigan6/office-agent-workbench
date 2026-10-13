// Explicit test dependencies only; never copy private fixtures or verification reports.
export const packageVerificationScripts=[
  'Inspect-ClaudeEntrypoints.ts','Verify-CoreEventReconnect.ts',
  'verification/model-task-cases.ts','verification/ppt-task-outcome.ts',
  'Verify-DiscoveryIdentity.ps1','Verify-ExcelChartGuards.ps1','Verify-ExcelChartScope.ps1','Verify-ExcelValueAxisPlan.ps1',
  'Verify-ExcelAppearanceFont.ps1','Verify-ExcelPackageScope.ps1','Verify-ExcelScalarSetter.ps1',
  'Verify-ExcelSelectionObject.ps1','Verify-PptAppearanceFingerprint.ps1','Verify-PptAliasRestore.ps1',
  'Verify-PptFrameFingerprint.ps1','Verify-PptBulletProfile.ps1','Verify-PptParagraphScope.ps1',
  'Verify-PptFrameProof.ps1','Verify-WordTableBorders.ps1','Verify-WordTableLayoutXml.ps1',
  'Verify-WordTableWidthsXml.ps1','Verify-WordFixtureLoops.ps1','Verify-WordWidthSetterGuards.ps1',
  'Trace-WordWidthRestore.ps1','Set-WordWidthOriginFixture.ps1','Export-WordTableWidthFixture.ps1',
];
