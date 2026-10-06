import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/vt323'
import './styles.css'
import './pixel/pixel.css'

// Không bọc StrictMode: <Html> của drei bị mount 2 lần trong StrictMode (React 19)
// làm bảng tên dồn về gốc toạ độ và báo lỗi "synchronously unmount a root".
createRoot(document.getElementById('root')!).render(<App />)
