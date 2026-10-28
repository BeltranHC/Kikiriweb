import Navbar from './Navbar';

export default function AppLayout({ children }) {
  return <><Navbar /><main className="app-main">{children}</main></>;
}
