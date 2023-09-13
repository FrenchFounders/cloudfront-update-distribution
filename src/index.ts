import * as core from "@actions/core";
import {
  CloudFrontClient,
  DistributionConfig,
  GetDistributionCommand,
  UpdateDistributionCommand,
  waitUntilDistributionDeployed,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import deepmerge from "deepmerge";

const combineMerge = <T = { Id?: string }>(target: T[], source: T[]) => {
  const final: { Id?: string }[] = target.slice();

  source.forEach((x: { Id?: string }) => {
    // if Id exists in source, check for the same one in destination
    if (x.Id) {
      const duplicateIndex = final.findIndex((y) => y.Id === x.Id);
      if (duplicateIndex > -1) {
        final[duplicateIndex] = deepmerge(final[duplicateIndex], x, {
          arrayMerge: combineMerge,
        });
      }
    } else {
      final.push(x);
    }
  });
  return final;
};

async function run(): Promise<void> {
  try {
    // Get inputs
    const accessKeyId = core.getInput("aws-access-key-id", { required: true });
    const secretAccessKey = core.getInput("aws-secret-access-key", {
      required: true,
    });
    const region = core.getInput("aws-region", { required: true });
    const distrubtionId = core.getInput("cloudfront-distribution-id", {
      required: true,
    });
    const distributionConfigString = core.getInput("cloudfront-distribution-config", { required: true });
    const cloudfrontInvalidationRequired = core.getBooleanInput("cloudfront-invalidation-required", { required: false }) || false;
    const cloudfrontInvalidationPath = core.getInput("cloudfront-invalidation-path", { required: false }) || "/*";
    const cloudfrontWaitForServiceUpdate = core.getBooleanInput("cloudfront-wait-for-service-update", { required: false }) || true;

    const client = new CloudFrontClient({
      credentials: { accessKeyId, secretAccessKey },
      region,
    });
    const getDistrubtion = new GetDistributionCommand({ Id: distrubtionId });
    const currentDistribution = await client.send(getDistrubtion);

    if (!currentDistribution.Distribution || !currentDistribution.Distribution.DistributionConfig) {
      throw new Error("Invalid distribution id");
    }

    core.info(`Input: ${distributionConfigString}`);

    core.info(`Fetched Config: ${JSON.stringify(currentDistribution.Distribution.DistributionConfig)}`);

    const inputDistributionConfig = JSON.parse(Buffer.from(distributionConfigString, "base64").toString()) as Partial<DistributionConfig>;
    const finalDistributionConfig = deepmerge<DistributionConfig>(currentDistribution.Distribution.DistributionConfig, inputDistributionConfig, {
      arrayMerge: combineMerge,
    });
    core.info(`Merged Config: ${JSON.stringify(finalDistributionConfig)}`);
    const updateDistribution = new UpdateDistributionCommand({
      IfMatch: currentDistribution.ETag,
      DistributionConfig: finalDistributionConfig,
      Id: distrubtionId,
    });
    const distributionOutput = await client.send(updateDistribution);
    core.setOutput("cloudfront-distribution-updated-id", distributionOutput.Distribution?.Id);

    if (cloudfrontWaitForServiceUpdate) {
      await waitUntilDistributionDeployed({ client, maxWaitTime: 10 * 60 * 60 }, { Id: distributionOutput.Distribution?.Id });
    }

    if (cloudfrontInvalidationRequired) {
      await client.send(
        new CreateInvalidationCommand({
          DistributionId: distributionOutput.Distribution?.Id,
          InvalidationBatch: { CallerReference: new Date().toISOString(), Paths: { Quantity: 1, Items: [cloudfrontInvalidationPath] } },
        })
      );
    }
  } catch (error) {
    core.setFailed(error.message);

    const showStackTrace = process.env.SHOW_STACK_TRACE;

    if (showStackTrace === "true") {
      throw error;
    }
  }
}

run();
