const { loadRuntimeSecrets } = require('../../src/secrets');

describe('loadRuntimeSecrets', () => {
  it('does nothing when AWS_SECRET_NAME is not set', async () => {
    const client = { send: jest.fn() };
    const env = {};

    await expect(loadRuntimeSecrets(env, client)).resolves.toBe(false);
    expect(client.send).not.toHaveBeenCalled();
    expect(env.REDIS_PASSWORD).toBeUndefined();
  });

  it('puts the Redis token from the named secret into the environment', async () => {
    const client = {
      send: jest.fn().mockResolvedValue({ SecretString: JSON.stringify({ redis_auth_token: 'tok' }) })
    };
    const env = { AWS_SECRET_NAME: 'app-secret' };

    await expect(loadRuntimeSecrets(env, client)).resolves.toBe(true);
    expect(client.send.mock.calls[0][0].input).toEqual({ SecretId: 'app-secret' });
    expect(env.REDIS_PASSWORD).toEqual('tok');
  });

  it('fails startup if the secret has no token', async () => {
    const client = { send: jest.fn().mockResolvedValue({ SecretString: '{}' }) };

    await expect(loadRuntimeSecrets({ AWS_SECRET_NAME: 'app-secret' }, client)).rejects.toThrow('redis_auth_token');
  });

  it('fails startup if Secrets Manager rejects the call', async () => {
    const client = { send: jest.fn().mockRejectedValue(new Error('AccessDenied')) };

    await expect(loadRuntimeSecrets({ AWS_SECRET_NAME: 'app-secret' }, client)).rejects.toThrow('AccessDenied');
  });
});
