export function lambdaName(stage: string, name: string): string {
  return `lnkshrtr-${stage}-${name}`;
}

export function cwLogGroupUrl(region: string, stage: string, name: string): string {
  const logGroup = `/aws/lambda/${lambdaName(stage, name)}`;
  const encoded = logGroup.replace(/\//g, "%2F");
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups$3FlogGroupNameFilter$3D${encoded}`;
}
