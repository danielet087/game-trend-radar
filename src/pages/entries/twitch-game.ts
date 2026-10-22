import '../../shared/styles/play.css';
import '../../features/twitch/styles.css';
import '../../features/twitch/detail.css';
import '../../features/twitch/statistics.css';
import '../../features/twitch/cooldown.css';
import { bootstrap } from '../../app/bootstrap.ts';
bootstrap('twitch-game').catch(error => {
  console.error('Unable to initialize Twitch history:', error);
  const notice = document.getElementById('historyStatus');
  if (notice) notice.textContent = '頁面暫時無法載入，請重新整理後再試。';
});
