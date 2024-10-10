import 'dotenv/config';
import { pino } from 'pino';
import { createRestAPIClient, createStreamingAPIClient } from 'masto';
import { getTotalMentionCount, getURLCount, shouldReportStatus, isNotificationEvent, isMentionNotification } from './utils';
import { RelationshipsStore } from './relationshipsstore';

const logger = pino({
  level: process.env.LOG_LEVEL
});

const restApi = createRestAPIClient({
  url: process.env.URL as string,
  accessToken: process.env.TOKEN,
});
const streamingAPI = createStreamingAPIClient({
  streamingApiUrl: process.env.URL as string,
  accessToken: process.env.TOKEN
});
const relationshipsStore = new RelationshipsStore(restApi);

(async () => {
  using events = streamingAPI.user.notification.subscribe();
  for await (const event of events) {
    try {
      if (isNotificationEvent(event) && isMentionNotification(event.payload)) {
        const status = event.payload.status;
        const isFollowing = await relationshipsStore.isFollowing(status.account.id);
        const totalMentionCount = getTotalMentionCount(status);
        const urlCount = getURLCount(status);
        const shouldReport = shouldReportStatus({
          isFollowing,
          totalMentionCount,
          urlCount
        });

        if (shouldReport) {
          logger.debug(`follow: ${isFollowing}, mentionCount: ${totalMentionCount}, urlCount: ${urlCount}`);
          try {
            await restApi.v1.reports.create({
              accountId: status.account.id,
              statusIds: [status.id],
              comment: process.env.REPORT_COMMENT,
              forward: false,
              category: 'spam'
            });
            logger.info(`スパム疑いのある投稿を通報しました\n${status.url}`);
          } catch(e) {
            logger.error(`通報処理中にエラーが発生しました\n${status.url}`, e);
          }
        }
      }
    } catch(e) {
      logger.error(`メッセージ処理中にエラーが発生しました`, e);
    }
  }
})();
