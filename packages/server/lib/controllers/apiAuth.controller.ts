import type { Request, Response, NextFunction } from 'express';
import type { LogLevel, LogAction } from '@nangohq/shared';
import {
    getAccount,
    getEnvironmentId,
    createActivityLog,
    errorManager,
    analytics,
    SyncClient,
    createActivityLogMessage,
    updateSuccess as updateSuccessActivityLog,
    updateProvider as updateProviderActivityLog,
    configService,
    connectionService,
    createActivityLogMessageAndEnd,
    AuthModes,
    getConnectionConfig,
    hmacService
} from '@nangohq/shared';

class ApiAuthController {
    async apiKey(req: Request, res: Response, next: NextFunction) {
        const accountId = getAccount(res);
        const environmentId = getEnvironmentId(res);
        const { providerConfigKey } = req.params;
        const connectionId = req.query['connection_id'] as string | undefined;
        const connectionConfig = req.query['params'] != null ? getConnectionConfig(req.query['params']) : {};

        const log = {
            level: 'info' as LogLevel,
            success: false,
            action: 'auth' as LogAction,
            start: Date.now(),
            end: Date.now(),
            timestamp: Date.now(),
            connection_id: connectionId as string,
            provider_config_key: providerConfigKey as string,
            environment_id: environmentId
        };

        const activityLogId = await createActivityLog(log);

        try {
            analytics.track('server:pre_api_key_auth', accountId);

            if (!providerConfigKey) {
                errorManager.errRes(res, 'missing_connection');

                return;
            }

            if (!connectionId) {
                errorManager.errRes(res, 'missing_connection_id');

                return;
            }

            const hmacEnabled = await hmacService.isEnabled(environmentId);
            if (hmacEnabled) {
                const hmac = req.query['hmac'] as string | undefined;
                if (!hmac) {
                    await createActivityLogMessageAndEnd({
                        level: 'error',
                        activity_log_id: activityLogId as number,
                        timestamp: Date.now(),
                        content: 'Missing HMAC in query params'
                    });

                    errorManager.errRes(res, 'missing_hmac');

                    return;
                }
                const verified = await hmacService.verify(hmac as string, environmentId, providerConfigKey as string, connectionId as string);
                if (!verified) {
                    await createActivityLogMessageAndEnd({
                        level: 'error',
                        activity_log_id: activityLogId as number,
                        timestamp: Date.now(),
                        content: 'Invalid HMAC'
                    });

                    errorManager.errRes(res, 'invalid_hmac');

                    return;
                }
            }

            const config = await configService.getProviderConfig(providerConfigKey as string, environmentId);

            if (config == null) {
                await createActivityLogMessageAndEnd({
                    level: 'error',
                    activity_log_id: activityLogId as number,
                    content: `Error during API Key auth: config not found`,
                    timestamp: Date.now()
                });

                errorManager.errRes(res, 'unknown_provider_config');

                return;
            }

            const template = await configService.getTemplate(config?.provider as string);

            if (template.auth_mode !== AuthModes.ApiKey) {
                await createActivityLogMessageAndEnd({
                    level: 'error',
                    activity_log_id: activityLogId as number,
                    timestamp: Date.now(),
                    content: `Provider ${config?.provider} does not support API key auth`
                });

                errorManager.errRes(res, 'invalid_auth_mode');

                return;
            }

            await updateProviderActivityLog(activityLogId as number, String(config?.provider));

            if (!req.body.apiKey) {
                errorManager.errRes(res, 'missing_api_key');

                return;
            }

            const { apiKey } = req.body;

            await createActivityLogMessage({
                level: 'info',
                activity_log_id: activityLogId as number,
                content: `API key auth creation was successful`,
                timestamp: Date.now()
            });

            await updateSuccessActivityLog(activityLogId as number, true);

            const [updatedConnection] = await connectionService.upsertApiConnection(
                connectionId as string,
                providerConfigKey as string,
                config?.provider as string,
                {
                    type: AuthModes.ApiKey,
                    apiKey
                },
                connectionConfig,
                environmentId,
                accountId
            );

            if (updatedConnection) {
                const syncClient = await SyncClient.getInstance();
                await syncClient?.initiate(updatedConnection.id);
            }

            res.status(200).send();
        } catch (err) {
            const prettyError = JSON.stringify(err, ['message', 'name'], 2);

            await createActivityLogMessage({
                level: 'error',
                activity_log_id: activityLogId as number,
                content: `Error during API key auth: ${prettyError}`,
                timestamp: Date.now()
            });

            errorManager.report(err, {
                accountId,
                metadata: {
                    providerConfigKey,
                    connectionId
                }
            });
            next(err);
        }
    }

    async basic(req: Request, res: Response, next: NextFunction) {
        const accountId = getAccount(res);
        const environmentId = getEnvironmentId(res);
        const { providerConfigKey } = req.params;
        const connectionId = req.query['connection_id'] as string | undefined;
        const connectionConfig = req.query['params'] != null ? getConnectionConfig(req.query['params']) : {};

        const log = {
            level: 'info' as LogLevel,
            success: false,
            action: 'auth' as LogAction,
            start: Date.now(),
            end: Date.now(),
            timestamp: Date.now(),
            connection_id: connectionId as string,
            provider_config_key: providerConfigKey as string,
            environment_id: environmentId
        };

        const activityLogId = await createActivityLog(log);

        try {
            analytics.track('server:pre_basic_api_key_auth', accountId);

            if (!providerConfigKey) {
                errorManager.errRes(res, 'missing_connection');

                return;
            }

            if (!connectionId) {
                errorManager.errRes(res, 'missing_connection_id');

                return;
            }

            if (!req.body.username) {
                errorManager.errRes(res, 'missing_basic_username');

                return;
            }

            const hmacEnabled = await hmacService.isEnabled(environmentId);
            if (hmacEnabled) {
                const hmac = req.query['hmac'] as string | undefined;
                if (!hmac) {
                    await createActivityLogMessageAndEnd({
                        level: 'error',
                        activity_log_id: activityLogId as number,
                        timestamp: Date.now(),
                        content: 'Missing HMAC in query params'
                    });

                    errorManager.errRes(res, 'missing_hmac');

                    return;
                }
                const verified = await hmacService.verify(hmac as string, environmentId, providerConfigKey as string, connectionId as string);
                if (!verified) {
                    await createActivityLogMessageAndEnd({
                        level: 'error',
                        activity_log_id: activityLogId as number,
                        timestamp: Date.now(),
                        content: 'Invalid HMAC'
                    });

                    errorManager.errRes(res, 'invalid_hmac');
                    return;
                }
            }

            const { username, password } = req.body;

            const config = await configService.getProviderConfig(providerConfigKey as string, environmentId);

            if (config == null) {
                await createActivityLogMessageAndEnd({
                    level: 'error',
                    activity_log_id: activityLogId as number,
                    content: `Error during basic API auth: config not found`,
                    timestamp: Date.now()
                });

                errorManager.errRes(res, 'unknown_provider_config');

                return;
            }

            const template = await configService.getTemplate(config?.provider as string);

            if (template.auth_mode !== AuthModes.Basic) {
                await createActivityLogMessageAndEnd({
                    level: 'error',
                    activity_log_id: activityLogId as number,
                    timestamp: Date.now(),
                    content: `Provider ${config?.provider} does not support Basic API auth`
                });

                errorManager.errRes(res, 'invalid_auth_mode');

                return;
            }

            await updateProviderActivityLog(activityLogId as number, String(config?.provider));

            await createActivityLogMessage({
                level: 'info',
                activity_log_id: activityLogId as number,
                content: `Basic API key auth creation was successful with the username ${username}`,
                timestamp: Date.now()
            });

            await updateSuccessActivityLog(activityLogId as number, true);

            const [updatedConnection] = await connectionService.upsertApiConnection(
                connectionId as string,
                providerConfigKey as string,
                config?.provider as string,
                {
                    type: AuthModes.Basic,
                    username,
                    password
                },
                connectionConfig,
                environmentId,
                accountId
            );

            if (updatedConnection) {
                const syncClient = await SyncClient.getInstance();
                await syncClient?.initiate(updatedConnection.id);
            }

            res.status(200).send();
        } catch (err) {
            const prettyError = JSON.stringify(err, ['message', 'name'], 2);

            await createActivityLogMessage({
                level: 'error',
                activity_log_id: activityLogId as number,
                content: `Error during basic API auth: ${prettyError}`,
                timestamp: Date.now()
            });

            errorManager.report(err, {
                accountId,
                metadata: {
                    providerConfigKey,
                    connectionId
                }
            });
            next(err);
        }
    }
}

export default new ApiAuthController();