import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PresentationsHomeComponent } from './presentations-home.component';

describe('PresentationsHomeComponent', () => {
  let component: PresentationsHomeComponent;
  let fixture: ComponentFixture<PresentationsHomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PresentationsHomeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PresentationsHomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
