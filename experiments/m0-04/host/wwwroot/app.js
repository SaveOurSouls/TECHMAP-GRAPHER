fetch('/api/v1/runtime-info').then(response => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}).then(info => {
  document.getElementById('program').textContent = info.programRoot;
  document.getElementById('data').textContent = info.dataRoot;
  const status = document.getElementById('status');
  status.textContent = info.separated ? 'Каталоги разделены' : 'Ошибка: данные находятся внутри программы';
  status.className = info.separated ? 'ok' : 'bad';
}).catch(error => {
  const status = document.getElementById('status');
  status.textContent = 'Сервер TECHMAP недоступен. Распакуйте архив и запустите Techmap.Server.exe. Подробность: ' + error.message;
  status.className = 'bad';
});
