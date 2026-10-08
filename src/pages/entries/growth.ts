import '../../shared/styles/play.css';
import '../../features/insights/styles.css';
import { bootstrap } from '../../app/bootstrap.ts';
bootstrap('growth').catch(error => {
  console.error('Unable to initialize game radar:', error);
  const notice = document.getElementById('notice') || document.getElementById('dataStatus');
  if (notice) { notice.hidden = false; notice.textContent = '網頁暫時無法載入，請重新整理後再試。'; }
});
