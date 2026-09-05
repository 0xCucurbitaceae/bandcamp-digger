export default function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-[88px] left-11 z-[35] whitespace-nowrap border border-[#2f2e2c] bg-[#1f1e1d] px-[13px] py-2 text-[11px] text-text">
      {message}
    </div>
  );
}
