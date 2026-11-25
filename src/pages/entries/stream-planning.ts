import '../../shared/styles/play.css';
import '../../features/twitch/styles.css';
import '../../features/twitch/stream-planning.css';
import { bootstrap } from '../../app/bootstrap.ts';

bootstrap('stream-planning').catch(error => {
  console.error('Unable to initialize stream planning:', error);
  const status = document.getElementById('streamPlanStatus');
  if (status) status.textContent = '選題頁暫時無法載入，請重新整理。';
});
