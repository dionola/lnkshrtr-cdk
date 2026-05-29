import { Duration } from "aws-cdk-lib";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

interface LambdaFunctionProps extends Omit<NodejsFunctionProps, "entry" | "runtime"> {
  entry: string;
  environment?: Record<string, string>;
}

export class LambdaFunction extends NodejsFunction {
  constructor(scope: Construct, id: string, props: LambdaFunctionProps) {
    super(scope, id, {
      runtime: Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: false,
        externalModules: [],
        nodeModules: ["bcryptjs"],
      },
      ...props,
    });
  }
}
