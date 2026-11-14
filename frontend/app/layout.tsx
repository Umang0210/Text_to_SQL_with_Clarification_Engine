import "./globals.css";
import "./data-management.css";
import "./calm-theme.css";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
