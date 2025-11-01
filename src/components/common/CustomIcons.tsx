import React, { SVGProps } from 'react';

export function RegexIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        d="M11 1.5a.5.5 0 0 0-1 0v3.13L7.29 3.06a.5.5 0 0 0-.5.866l2.71 1.57l-2.71 1.57a.5.5 0 0 0 .5.866L10 6.362v3.13a.5.5 0 0 0 1 0v-3.13l2.71 1.57a.5.5 0 0 0 .5-.866l-2.71-1.57l2.71-1.57a.5.5 0 0 0-.5-.866L11 4.63zM3.08 11.6c-.076.184-.076.417-.076.883s0 .699.076.883c.101.245.296.44.541.541c.184.076.417.076.883.076s.699 0 .883-.076a1 1 0 0 0 .541-.541c.076-.184.076-.417.076-.883s0-.699-.076-.883a1 1 0 0 0-.541-.541c-.184-.076-.417-.076-.883-.076s-.699 0-.883.076a1 1 0 0 0-.541.541"
      ></path>
    </svg>
  );
}

export function SelectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="m6 9.657l1.414 1.414l4.243-4.243l4.243 4.243l1.414-1.414L11.657 4zm0 4.786l1.414-1.414l4.243 4.243l4.243-4.243l1.414 1.414l-5.657 5.657z"
      ></path>
    </svg>
  );
}

export function SquareShareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-prefix="far"
      data-icon="arrow-up-right-from-square"
      className="svg-inline--fa fa-arrow-up-right-from-square aspect-square"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      data-testid="arrow-up-right-from-square-icon"
      {...props}
    >
      <path
        fill="currentColor"
        d="M304 24c0 13.3 10.7 24 24 24l102.1 0L207 271c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l223-223L464 184c0 13.3 10.7 24 24 24s24-10.7 24-24l0-160c0-13.3-10.7-24-24-24L328 0c-13.3 0-24 10.7-24 24zM72 32C32.2 32 0 64.2 0 104L0 440c0 39.8 32.2 72 72 72l336 0c39.8 0 72-32.2 72-72l0-128c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 128c0 13.3-10.7 24-24 24L72 464c-13.3 0-24-10.7-24-24l0-336c0-13.3 10.7-24 24-24l128 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L72 32z"
      ></path>
    </svg>
  );
}
