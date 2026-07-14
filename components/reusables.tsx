export const GrayTitle = ({ children }: { children: React.ReactNode }) => {
  return <span className="text-white/90">{children}</span>;
};

export const BlueTitle = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <span
      className={`bg-linear-to-br font-serif from-[#E8A488] via-[#DD8967] to-[#B85C3E] bg-clip-text text-transparent ${className}`}
    >
      {children}
    </span>
  );
};

export const SectionLabel1 = ({ children }: { children: React.ReactNode }) => {
  return (
    <p className="inline-flex items-center gap-2 text-xs font-semibold text-[#DD8967] tracking-[0.14em] uppercase mb-4">
      <span className="w-4 h-px bg-[#DD8967]" />
      {children}
      <span className="w-4 h-px bg-[#DD8967]" />
    </p>
  );
};

export const SectionHeading = ({
    gray,
    blue,
}:{ gray: string;
    blue: string;
}) => {
    return (
        <h2 className="font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-tight">
            <GrayTitle>{gray}</GrayTitle> 
            <br />
            <BlueTitle>{blue}</BlueTitle>
        </h2>
    )
}