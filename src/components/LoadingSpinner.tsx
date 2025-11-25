import React from 'react';

interface LoadingSpinnerProps {
  text?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  textColor?: 'gray' | 'white';
  spinnerColor?: 'red' | 'white';
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
  text, 
  size = 'md',
  className = '',
  textColor = 'gray',
  spinnerColor = 'red'
}) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6'
  };

  const spinnerColorClass = spinnerColor === 'white' ? 'text-white' : 'text-red-600';
  const textColorClass = textColor === 'white' ? 'text-white' : 'text-gray-600';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        className={`animate-spin ${sizeClasses[size]} ${spinnerColorClass}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      {text && (
        <span className={`${textColorClass} text-sm font-medium`}>{text}</span>
      )}
    </div>
  );
};

export default LoadingSpinner;

