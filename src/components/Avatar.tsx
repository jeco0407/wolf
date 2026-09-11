import Image from "next/image";

type Props = {
  src: string;
  size: number;
  alt?: string;
  className?: string;
};

export function Avatar({ src, size, alt = "", className = "" }: Props) {
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`rounded-full object-cover ring-1 ring-gold/30 ${className}`}
    />
  );
}
