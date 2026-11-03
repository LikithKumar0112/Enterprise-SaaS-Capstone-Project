// Loads runtime secrets from AWS Secrets Manager into process.env at startup.
// Flow: Secrets Manager <- IAM role <- IRSA (ServiceAccount) <- this pod.
// With AWS_SECRET_NAME unset (local dev, CI) this is a no-op, and REDIS_PASSWORD
// can be supplied directly if the local Redis needs one.
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function loadRuntimeSecrets(env = process.env, client = new SecretsManagerClient({})) {
  if (!env.AWS_SECRET_NAME) return false;

  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: env.AWS_SECRET_NAME })
  );
  const secret = JSON.parse(SecretString);
  if (!secret.redis_auth_token) {
    throw new Error(`Secret ${env.AWS_SECRET_NAME} has no redis_auth_token`);
  }
  env.REDIS_PASSWORD = secret.redis_auth_token;
  return true;
}

module.exports = { loadRuntimeSecrets };
