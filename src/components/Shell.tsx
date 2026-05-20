import Header from "./Header";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="max-w-content mx-auto px-6 py-8">{children}</main>
    </>
  );
}
