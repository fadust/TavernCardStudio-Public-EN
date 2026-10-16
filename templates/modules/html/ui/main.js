import './style.css';
const button = document.querySelector('#toggle');
const detail = document.querySelector('#detail');
button.addEventListener('click', () => {
  detail.hidden = !detail.hidden;
  button.textContent = detail.hidden ? 'Show instructions' : 'Hide instructions';
});
