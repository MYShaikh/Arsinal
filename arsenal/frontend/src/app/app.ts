import { Component, inject } from '@angular/core';

import { MapComponent } from './components/map.component';
import { SidebarComponent } from './components/sidebar.component';
import { AlertService } from './services/alert.service';
import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  imports: [SidebarComponent, MapComponent],
  template: `
    @if (alerts.active(); as alert) {
      @if (!alerts.dismissed()) {
        <div class="alarm" role="alert">
          <span class="sign" aria-hidden="true">!</span>
          <span class="message">
            <b>Nuclear power plant within 100 m</b>
            <span>{{ alert.plant.name }} is {{ alert.distance }} m from your position.</span>
          </span>
          <button type="button" (click)="alerts.dismiss()">Dismiss</button>
        </div>
      }
    }
    <app-sidebar />
    <app-map />
    @if (toast.message(); as message) {
      <div class="toast" role="status" (click)="toast.dismiss()">{{ message }}</div>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: 400px 1fr;
      height: 100dvh;
    }
    .alarm {
      position: fixed;
      top: 0;
      right: 0;
      left: 0;
      z-index: 200;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 20px;
      background: #c62828;
      color: #fff;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
      animation: alarm-flash 1s ease-in-out 3;
    }
    @keyframes alarm-flash {
      50% {
        background: #ff5252;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .alarm {
        animation: none;
      }
    }
    .sign {
      display: grid;
      place-items: center;
      flex: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #fff;
      color: #c62828;
      font-size: 22px;
      font-weight: 700;
    }
    .message {
      display: flex;
      flex: 1;
      flex-direction: column;
      font-size: 14px;
      line-height: 1.35;
    }
    .message b {
      font-size: 16px;
    }
    .alarm button {
      padding: 6px 16px;
      border: 1px solid #fff;
      border-radius: 16px;
      background: transparent;
      color: #fff;
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }
    .alarm button:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      z-index: 100;
      max-width: min(90vw, 480px);
      padding: 12px 20px;
      border-radius: 8px;
      background: #323232;
      color: #fff;
      font-size: 14px;
      transform: translateX(-50%);
      box-shadow: var(--shadow-2);
    }
    @media (max-width: 768px) {
      :host {
        grid-template-columns: 1fr;
        grid-template-rows: 55dvh 1fr;
      }
      app-sidebar {
        order: 2;
      }
      app-map {
        order: 1;
      }
    }
  `,
})
export class App {
  protected readonly toast = inject(ToastService);
  protected readonly alerts = inject(AlertService);
}
