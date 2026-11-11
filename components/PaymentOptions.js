'use client';
import { Banknote, Smartphone, Clock3, CheckCircle } from 'lucide-react';
import styles from './PaymentOptions.module.css';

export default function PaymentOptions({ label, value, onChange, disabled = false, allowPending = false, disabledMethods = [], recordedLabel }) {
  const options = [
    { value: 'cash', label: 'Efectivo', Icon: Banknote },
    { value: 'yape', label: 'Yape', Icon: Smartphone },
    ...(allowPending ? [{ value: 'pending', label: 'Pendiente de pago', Icon: Clock3 }] : []),
    ...(recordedLabel ? [{ value: 'recorded', label: recordedLabel, Icon: CheckCircle }] : []),
  ];

  return <fieldset className={styles.fieldset} disabled={disabled}>
    <legend>{label}</legend>
    <div className={styles.options}>
      {options.map(({ value: method, label: text, Icon }) => <button key={method} type="button" className={styles.option}
        aria-pressed={value === method} disabled={disabledMethods.includes(method)} onClick={() => onChange(method)}>
        <Icon size={20} aria-hidden="true" /><span>{text}</span>
      </button>)}
    </div>
  </fieldset>;
}
