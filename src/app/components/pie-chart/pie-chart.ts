import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import { ChartOptions, Chart, ArcElement, Tooltip, Legend, Title, PieController } from 'chart.js';

// Registre o Chart.js aqui, e não mais no Home
Chart.register(PieController, ArcElement, Tooltip, Legend, Title);

export interface CategoryBreakdown {
  labels: string[];
  data: number[];
}

@Component({
  selector: 'app-category-pie-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  template: `
    @if (breakdown().data.length > 0) {
      <div class="relative h-64">
        <canvas
          baseChart
          [data]="chartData()"
          [options]="chartOptions"
          [type]="'pie'">
        </canvas>
      </div>
    } @else {
      <div class="flex items-center justify-center h-64 text-gray-500">
        Nenhum dado de categoria para exibir.
      </div>
    }
  `
})
export class CategoryPieChartComponent {

  // 1. Receba os dados prontos como um Input (Signal)
  breakdown = input.required<CategoryBreakdown>();

  // 2. O chartData agora é um 'computed' baseado no input
  chartData = computed(() => {
    return {
      labels: this.breakdown().labels,
      datasets: [
        {
          data: this.breakdown().data,
          backgroundColor: [
            '#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'
          ],
          hoverOffset: 10
        }
      ]
    };
  });

  // 3. As opções do gráfico vivem aqui
  public chartOptions: ChartOptions<'pie'> = {
    responsive: true,
    plugins: {
      legend: {
        position: 'bottom',
      },
      title: {
        display: true,
        text: 'Gastos por Categoria',
      },
    },
  };
}